import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// Controlled IPC boundaries exercise the shipped SvelteKit router, including its preload cache.
export async function routeDataWorkflow(application, page, directory, development) {
	const ids = {};
	for (const name of ["Receipt A", "Receipt B", "Receipt C"]) {
		const todoPath = join(directory, `${name}.txt`);
		await writeFile(todoPath, `${name} item\n`);
		const outcome = await page.evaluate((input) => window.desktop.createWorkspace(input), {
			name,
			color: "blue",
			todoPath,
		});
		assert.equal(outcome.status, "applied");
		ids[name] = outcome.confirmed.session.catalogue.active_workspace_id;
	}
	const url = (id) => new URL(id ? `/workspaces/${id}` : "/", page.url()).href;
	const navigate = (id) =>
		page.evaluate((href) => {
			const link = document.createElement("a");
			link.href = href;
			link.dataset.sveltekitPreloadData = "off";
			document.body.append(link);
			link.click();
			link.remove();
		}, url(id));
	const enabled = (locator) => locator.and(page.locator(":enabled")).waitFor();
	const item = (name, completed = false) =>
		page.getByRole("checkbox", {
			name: `Mark ${name} item ${completed ? "incomplete" : "complete"}`,
			exact: true,
		});
	await page.goto(url(ids["Receipt A"]));
	await enabled(item("Receipt A"));
	await application.evaluate(({ ipcMain }) => {
		const channels = [
			"read-workspace",
			"read-saved-views",
			"switch-workspace",
			"set-todo-completion",
		];
		const state = (globalThis.routeTest = {
			originals: {},
			gates: {},
			activations: [],
			writes: 0,
			savedReads: 0,
			rejectActivation: false,
		});
		for (const name of channels) {
			const channel = `tuxedo:${name}`;
			state.originals[name] = ipcMain._invokeHandlers.get(channel);
			ipcMain.removeHandler(channel);
			ipcMain.handle(channel, async (event, input) => {
				if (name === "switch-workspace") {
					state.activations.push(input.workspaceId);
					if (state.rejectActivation) {
						state.rejectActivation = false;
						return { status: "rejected", message: "Activation rejected before commit" };
					}
				}
				if (name === "set-todo-completion") state.writes++;
				if (name === "read-saved-views") state.savedReads++;
				const result = await state.originals[name](event, input);
				if (
					name === "switch-workspace" &&
					state.failAfterActivation === input.workspaceId &&
					result.status === "applied"
				) {
					state.failAfterActivation = null;
					state.gates[input.workspaceId] = {
						used: false,
						fail: true,
						enter: () => {},
						released: Promise.resolve(),
					};
				}
				const gate = name === "read-workspace" && state.gates[input.workspaceId];
				if (gate && !gate.used) {
					gate.used = true;
					gate.enter();
					await gate.released;
					if (gate.fail)
						return {
							status: "rejected",
							reason: "unexpected",
							message: "Controlled route read unavailable",
						};
				}
				return result;
			});
		}
	});
	const arm = (id, fail = false) =>
		application.evaluate(
			(_electron, { id, fail }) => {
				const gate = { used: false, fail };
				gate.entered = new Promise((resolve) => (gate.enter = resolve));
				gate.released = new Promise((resolve) => (gate.release = resolve));
				globalThis.routeTest.gates[id] = gate;
			},
			{ id, fail }
		);
	const entered = (id) =>
		application.evaluate(async (_electron, id) => {
			await globalThis.routeTest.gates[id].entered;
		}, id);
	const release = (id) =>
		application.evaluate((_electron, id) => globalThis.routeTest.gates[id].release(), id);
	const counts = () =>
		application.evaluate(() => ({
			activations: globalThis.routeTest.activations,
			writes: globalThis.routeTest.writes,
			savedReads: globalThis.routeTest.savedReads,
		}));
	const selection = () =>
		page.evaluate(
			async () => (await window.desktop.readSession({})).session.catalogue.active_workspace_id
		);
	try {
		// An RPC response cannot publish contents or release admission before the loader reaches the screen.
		const before = await counts();
		await page.evaluate(() => {
			window.retainedReader = document.querySelector("[data-todo-reader]");
		});
		await arm(ids["Receipt A"]);
		await item("Receipt A").click();
		await entered(ids["Receipt A"]);
		assert.equal(await item("Receipt A").isChecked(), false);
		assert.equal(await item("Receipt A").isEnabled(), false);
		await release(ids["Receipt A"]);
		await enabled(item("Receipt A", true));
		assert.equal(
			await page.evaluate(
				() => window.retainedReader === document.querySelector("[data-todo-reader]")
			),
			true
		);
		assert.equal(
			(await counts()).savedReads,
			before.savedReads,
			"Todo invalidation never reloads saved views"
		);

		// A failed read retains this route's reader and exposes a read-only retry, never another write.
		await arm(ids["Receipt A"], true);
		await item("Receipt A", true).click();
		await entered(ids["Receipt A"]);
		await release(ids["Receipt A"]);
		const retry = page.getByRole("button", { name: "Retry refresh", exact: true });
		await enabled(retry);
		await page.getByText(/Change saved, but the Workspace could not be refreshed/).waitFor();
		assert.equal(await item("Receipt A", true).isEnabled(), false);
		assert.equal(
			await page.evaluate(
				() => window.retainedReader === document.querySelector("[data-todo-reader]")
			),
			true
		);
		const savedWrites = (await counts()).writes;
		await retry.click();
		await enabled(item("Receipt A"));
		assert.equal((await counts()).writes, savedWrites);

		// Home and re-entry recover a committed change through reads, without another activation or write.
		await arm(ids["Receipt A"], true);
		await item("Receipt A").click();
		await entered(ids["Receipt A"]);
		await release(ids["Receipt A"]);
		await enabled(retry);
		const homeRecoveryWrites = (await counts()).writes;
		await page.getByRole("link", { name: "Home", exact: true }).click();
		await page.getByRole("navigation", { name: "Saved workspaces" }).waitFor();
		await page.getByRole("link", { name: "Receipt A", exact: true }).click();
		await enabled(item("Receipt A", true));
		assert.equal((await counts()).writes, homeRecoveryWrites);
		assert.deepEqual((await counts()).activations, []);

		// Hover reads B while A and its Undo remain selected. The cached speculative result cannot authorize B.
		await navigate(null);
		await page.getByRole("navigation", { name: "Saved workspaces" }).waitFor();
		const undo = await page.evaluate(async () => (await window.desktop.readSession({})).undoLabel);
		await arm(ids["Receipt B"]);
		await page.getByRole("link", { name: "Receipt B", exact: true }).hover();
		await entered(ids["Receipt B"]);
		assert.equal(await selection(), ids["Receipt A"]);
		assert.equal(
			await page.evaluate(async () => (await window.desktop.readSession({})).undoLabel),
			undo
		);
		assert.deepEqual((await counts()).activations, []);
		await release(ids["Receipt B"]);
		await page.getByRole("link", { name: "Receipt B", exact: true }).click();
		await enabled(item("Receipt B"));
		assert.deepEqual((await counts()).activations, [ids["Receipt B"]]);

		// beforeNavigate is skipped on supersession: neither stale A nor its completion can unlock C.
		await navigate(null);
		await page.getByRole("navigation", { name: "Saved workspaces" }).waitFor();
		await arm(ids["Receipt A"]);
		await arm(ids["Receipt C"]);
		await navigate(ids["Receipt A"]);
		await entered(ids["Receipt A"]);
		await navigate(ids["Receipt C"]);
		await entered(ids["Receipt C"]);
		await release(ids["Receipt A"]);
		assert.equal(await selection(), ids["Receipt B"]);
		assert.deepEqual((await counts()).activations, [ids["Receipt B"]]);
		await release(ids["Receipt C"]);
		await enabled(item("Receipt C"));
		assert.deepEqual((await counts()).activations, [ids["Receipt B"], ids["Receipt C"]]);
		assert.equal(await selection(), ids["Receipt C"]);

		// A real external change during a held post-write read is accepted before its event and eventually published.
		const observationCounts = await counts();
		await page.evaluate((id) => {
			window.observationReceived = new Promise((resolve) => {
				const stop = window.desktop.onTodoFileChanged((event) => {
					if (event.workspaceId === id) {
						stop();
						resolve(event);
					}
				});
			});
		}, ids["Receipt C"]);
		await arm(ids["Receipt C"]);
		await item("Receipt C").click();
		await entered(ids["Receipt C"]);
		await writeFile(join(directory, "Receipt C.txt"), "External during refresh\n");
		const observed = await page.evaluate(async () => await window.observationReceived);
		const authoritative = await page.evaluate(
			(workspaceId) => window.desktop.readWorkspace({ workspaceId }),
			ids["Receipt C"]
		);
		assert.equal(authoritative.provenance.status, "confirmed");
		assert.equal(authoritative.provenance.selection.revision, observed.revision);
		await release(ids["Receipt C"]);
		await enabled(
			page.getByRole("checkbox", { name: "Mark External during refresh complete", exact: true })
		);
		assert.equal((await counts()).writes, observationCounts.writes + 1);
		assert.equal((await counts()).savedReads, observationCounts.savedReads);
		assert.equal(
			await page.evaluate(async () => (await window.desktop.readSession({})).undoLabel),
			undefined
		);

		// Activation rejection and committed activation/refresh failure have different recovery semantics.
		await application.evaluate(() => {
			globalThis.routeTest.rejectActivation = true;
		});
		await navigate(ids["Receipt A"]);
		await page.getByText("Activation rejected before commit", { exact: true }).waitFor();
		await page.waitForURL(url(null));
		assert.equal(await selection(), ids["Receipt C"]);
		await application.evaluate((_electron, id) => {
			globalThis.routeTest.failAfterActivation = id;
		}, ids["Receipt B"]);
		await navigate(ids["Receipt B"]);
		await enabled(retry);
		assert.equal(
			await selection(),
			ids["Receipt B"],
			"Refresh failure cannot roll back committed activation"
		);
		const activated = (await counts()).activations;
		await retry.click();
		await enabled(item("Receipt B"));
		assert.deepEqual(
			(await counts()).activations,
			activated,
			"Retry never repeats a committed activation"
		);

		// UI creation commits activation once and transfers its admission/receipt to the new route.
		await navigate(null);
		await page.getByRole("navigation", { name: "Saved workspaces" }).waitFor();
		const createdPath = join(directory, "Receipt created.txt");
		await writeFile(createdPath, "Created receipt item\n");
		await application.evaluate(({ ipcMain }, path) => {
			globalThis.routeTest.originals["select-todo-file"] =
				ipcMain._invokeHandlers.get("tuxedo:select-todo-file");
			ipcMain.removeHandler("tuxedo:select-todo-file");
			ipcMain.handle("tuxedo:select-todo-file", () => path);
		}, createdPath);
		const beforeCreation = (await counts()).activations;
		await page.getByRole("button", { name: "New workspace", exact: true }).click();
		await page.getByRole("textbox", { name: "Workspace name" }).fill("Receipt created");
		await page.getByRole("button", { name: "Todo file", exact: true }).click();
		await page.getByText(createdPath, { exact: true }).waitFor();
		await page.getByRole("button", { name: "Create workspace", exact: true }).click();
		await enabled(
			page.getByRole("checkbox", { name: "Mark Created receipt item complete", exact: true })
		);
		assert.deepEqual(
			(await counts()).activations,
			beforeCreation,
			"Creation never switches its already activated Workspace twice"
		);
		await navigate(ids["Receipt B"]);
		await enabled(item("Receipt B"));

		if (!development) {
			// Demonstrate native thrown-load replacement against the actual installed router, then recover.
			await page.evaluate(() => {
				window.nativeURL = window.URL;
				window.URL = class extends window.nativeURL {
					constructor(input, ...base) {
						if (String(input).startsWith("tuxedodata:workspace:"))
							throw Error("Controlled native loader exception");
						super(input, ...base);
					}
				};
				window.nativeErrorCommitted = new Promise((resolve) => {
					const observer = new MutationObserver(() => {
						if (document.querySelector("h1")?.textContent === "500") {
							observer.disconnect();
							resolve();
						}
					});
					observer.observe(document, { subtree: true, childList: true });
				});
			});
			await navigate(null);
			await page.getByRole("navigation", { name: "Saved workspaces" }).waitFor();
			await navigate(ids["Receipt C"]);
			await page.evaluate(async () => {
				await window.nativeErrorCommitted;
			});
			await page.waitForURL(url(null));
			assert.equal(
				await page.locator("[data-todo-reader]").count(),
				0,
				"A thrown loader replaces the native reader branch"
			);
			await page.evaluate(() => {
				window.URL = window.nativeURL;
			});
			await page.reload();
			await enabled(item("Receipt B"));
		}
		console.log(
			"Actual router: targeted publication, retained failures/read-only Retry, harmless preload, superseded navigation, activation recovery, and native loader-error replacement passed."
		);
	} finally {
		await application.evaluate(({ ipcMain }) => {
			for (const [name, handler] of Object.entries(globalThis.routeTest.originals)) {
				ipcMain.removeHandler(`tuxedo:${name}`);
				ipcMain.handle(`tuxedo:${name}`, handler);
			}
			delete globalThis.routeTest;
		});
	}
}
