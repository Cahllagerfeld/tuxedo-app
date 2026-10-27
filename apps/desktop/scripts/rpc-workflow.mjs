import { readConfirmation } from "./read-confirmation.mjs";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Hold actual IPC responses to exercise admission and observation through the shipped renderer.
export async function rpcWorkflow(application, page, directory) {
	const ids = {};
	for (const name of ["RPC A", "RPC B"]) {
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
			document.body.append(link);
			link.click();
			link.remove();
		}, url(id));
	const enabled = (locator) => locator.and(page.locator(":enabled")).waitFor();
	const item = (name, completed = false) =>
		page.getByRole("checkbox", {
			name: `Mark ${name} ${completed ? "incomplete" : "complete"}`,
			exact: true,
		});
	await page.goto(url(ids["RPC A"]));
	await enabled(item("RPC A item"));
	await application.evaluate(({ ipcMain }) => {
		const state = (globalThis.rpcTest = {
			originals: {},
			reads: 0,
			refreshes: 0,
			savedReads: 0,
			writes: 0,
			activations: [],
			gate: null,
			readGate: null,
			failRead: false,
		});
		for (const name of [
			"read-session",
			"read-workspace",
			"refresh-session",
			"read-saved-views",
			"set-todo-completion",
			"switch-workspace",
		]) {
			const channel = `tuxedo:${name}`;
			state.originals[name] = ipcMain._invokeHandlers.get(channel);
			ipcMain.removeHandler(channel);
			ipcMain.handle(channel, async (event, input) => {
				if (name === "read-workspace") {
					state.reads++;
					if (state.failRead) {
						state.failRead = false;
						throw Error("Controlled Workspace read unavailable");
					}
				}
				if (name === "read-saved-views") state.savedReads++;
				if (name === "refresh-session") state.refreshes++;
				if (name === "set-todo-completion") state.writes++;
				if (name === "switch-workspace") state.activations.push(input.workspaceId);
				const result = await state.originals[name](event, input);
				if (name === "read-workspace" && state.readGate) {
					const gate = state.readGate;
					state.readGate = null;
					gate.enter();
					await gate.released;
				}
				if (name === "set-todo-completion" && state.gate) {
					const gate = state.gate;
					state.gate = null;
					gate.enter();
					await gate.released;
				}
				return result;
			});
		}
	});
	const counts = () =>
		application.evaluate(() => ({
			reads: globalThis.rpcTest.reads,
			refreshes: globalThis.rpcTest.refreshes,
			savedReads: globalThis.rpcTest.savedReads,
			writes: globalThis.rpcTest.writes,
			activations: globalThis.rpcTest.activations,
		}));
	const arm = () =>
		application.evaluate(() => {
			const gate = (globalThis.rpcTest.gate = {});
			gate.entered = new Promise((resolve) => (gate.enter = resolve));
			gate.released = new Promise((resolve) => (gate.release = resolve));
			globalThis.rpcTest.held = gate;
		});
	const entered = () => application.evaluate(() => globalThis.rpcTest.held.entered);
	const release = () => application.evaluate(() => globalThis.rpcTest.held.release());
	const armRead = () =>
		application.evaluate(() => {
			const gate = (globalThis.rpcTest.readGate = {});
			gate.entered = new Promise((resolve) => (gate.enter = resolve));
			gate.released = new Promise((resolve) => (gate.release = resolve));
			globalThis.rpcTest.heldRead = gate;
		});
	const observeNextChange = () =>
		page.evaluate((id) => {
			window.rpcObservation = new Promise((resolve) => {
				const stop = window.desktop.onTodoFileChanged((event) => {
					if (event.workspaceId === id) {
						stop();
						resolve(event);
					}
				});
			});
		}, ids["RPC A"]);
	try {
		// Contents change only after the loader re-reads, even when the write RPC has completed.
		const before = await counts();
		await page.evaluate(() => {
			window.retainedReader = document.querySelector("[data-todo-reader]");
		});
		await arm();
		await item("RPC A item").click();
		await entered();
		assert.equal(await item("RPC A item").isChecked(), false);
		assert.equal(await item("RPC A item").isEnabled(), false);
		await armRead();
		await release();
		await application.evaluate(() => globalThis.rpcTest.heldRead.entered);
		assert.equal(await item("RPC A item").isChecked(), false);
		assert.equal(await item("RPC A item").isEnabled(), false);
		await application.evaluate(() => globalThis.rpcTest.heldRead.release());
		await enabled(item("RPC A item", true));
		assert.equal(
			(await counts()).reads,
			before.reads + 1,
			"Todo commands refresh their page loader"
		);
		assert.equal((await counts()).savedReads, before.savedReads);
		assert.equal(
			await page.evaluate(
				() => window.retainedReader === document.querySelector("[data-todo-reader]")
			),
			true,
			"Same-Workspace updates keep the reader mounted"
		);

		// A newer observed revision must survive a delayed older command response.
		await observeNextChange();
		await arm();
		await item("RPC A item", true).click();
		await entered();
		await writeFile(join(directory, "RPC A.txt"), "External during command\n");
		await page.evaluate(() => window.rpcObservation);
		await release();
		await enabled(item("External during command"));
		assert.equal((await readConfirmation(page)).undoLabel, undefined);
		assert.equal((await counts()).savedReads, before.savedReads);

		// A failed observation read retains the reader and Retry reads without replaying a write.
		await application.evaluate(() => {
			globalThis.rpcTest.failRead = true;
		});
		await writeFile(join(directory, "RPC A.txt"), "Recovered external item\n");
		const retry = page.getByRole("button", { name: "Retry refresh", exact: true });
		await enabled(retry);
		await page.getByText(/Controlled Workspace read unavailable/).waitFor();
		assert.equal(await item("External during command").isEnabled(), false);
		const writes = (await counts()).writes;
		const refreshes = (await counts()).refreshes;
		await retry.click();
		await enabled(item("Recovered external item"));
		assert.equal((await counts()).writes, writes);
		assert.equal((await counts()).refreshes, refreshes + 1, "Retry explicitly reconciles disk");

		// Home and same-Workspace re-entry preserve selection and Undo; another Workspace activates once.
		await item("Recovered external item").click();
		await enabled(item("Recovered external item", true));
		const confirmed = await readConfirmation(page);
		await navigate(null);
		await page.getByRole("navigation", { name: "Saved workspaces" }).waitFor();
		await page.getByRole("link", { name: "RPC B", exact: true }).hover();
		assert.deepEqual(await readConfirmation(page), confirmed);
		assert.deepEqual((await counts()).activations, []);
		await page.getByRole("link", { name: "RPC A", exact: true }).click();
		await enabled(item("Recovered external item", true));
		assert.deepEqual(await readConfirmation(page), confirmed);
		await navigate(ids["RPC B"]);
		await enabled(item("RPC B item"));
		assert.deepEqual((await counts()).activations, [ids["RPC B"]]);

		// Observation while Home is open retires a missing file without activating anything.
		await navigate(null);
		await page.getByRole("navigation", { name: "Saved workspaces" }).waitFor();
		const path = join(directory, "RPC B.txt");
		const contents = await readFile(path, "utf8");
		try {
			await rm(path);
			await page.getByText("Workspace unavailable", { exact: true }).waitFor();
			await enabled(page.getByRole("button", { name: "New workspace", exact: true }));
			assert.equal((await readConfirmation(page)).session.status, "empty");
			assert.deepEqual((await counts()).activations, [ids["RPC B"]]);
		} finally {
			await writeFile(path, contents);
		}
		await page.getByRole("link", { name: "RPC B", exact: true }).click();
		await enabled(item("RPC B item"));
		assert.deepEqual((await counts()).activations, [ids["RPC B"], ids["RPC B"]]);
		console.log(
			"Loader-owned updates, shared admission, observation during commands, read-only recovery, harmless preload and Home recovery passed."
		);
	} finally {
		await application.evaluate(({ ipcMain }) => {
			globalThis.rpcTest.held?.release();
			globalThis.rpcTest.heldRead?.release();
			for (const [name, handler] of Object.entries(globalThis.rpcTest.originals)) {
				ipcMain.removeHandler(`tuxedo:${name}`);
				ipcMain.handle(`tuxedo:${name}`, handler);
			}
			delete globalThis.rpcTest;
		});
	}
}
