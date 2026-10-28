import { readConfirmation, activateWorkspace } from "./read-confirmation.mjs";
import { rpcWorkflow } from "./rpc-workflow.mjs";
import { workspaceSetupWorkflow } from "./workspace-setup-workflow.mjs";
import { kanbanRoutingWorkflow } from "./kanban-routing-workflow.mjs";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import electronPath from "electron";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const development = process.argv.includes("--dev");
const visible = process.argv.includes("--visible");
const directory = await mkdtemp(join(tmpdir(), "tuxedo-electron-"));
let application;
let vite;
delete process.env.ELECTRON_RUN_AS_NODE;
const environment = {
	...process.env,
	TUXEDO_USER_DATA: directory,
	TUXEDO_TEST_HIDDEN: visible ? "0" : "1",
};
delete environment.TUXEDO_RENDERER_ORIGIN;
const launchApplication = () =>
	electron.launch({
		timeout: 20000,
		executablePath: electronPath,
		args: [resolve("dist-electron/main.js")],
		env: environment,
	});
const assertWindowState = async (page) => {
	if (!visible) {
		await page.waitForLoadState("load");
		assert.equal(
			await application.evaluate(({ BrowserWindow }) =>
				BrowserWindow.getAllWindows()[0].isVisible()
			),
			false,
			"Application window must stay hidden"
		);
		return;
	}
	// The first window can be observed before startup finishes.
	for (let attempt = 0; attempt < 100; attempt++) {
		const state = await application.evaluate(({ BrowserWindow }) => {
			const window = BrowserWindow.getAllWindows()[0];
			return {
				maximized: window.isMaximized(),
				fullscreen: window.isFullScreen(),
				visible: window.isVisible(),
			};
		});
		assert.equal(state.fullscreen, false, "Application window must keep native fullscreen off");
		if (state.maximized && state.visible) {
			console.log("Application window opens maximized with native fullscreen off.");
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.fail("Application window must open maximized");
};
try {
	if (development) {
		vite = spawn(
			process.execPath,
			["node_modules/vite/bin/vite.js", "--mode", "electron", "--host", "127.0.0.1"],
			{ stdio: "ignore", env: { ...process.env, ELECTRON_STARTUP_PREVENT: "1" } }
		);
		const origin = "http://127.0.0.1:1420";
		for (let attempt = 0; attempt < 100; attempt++) {
			if (vite.exitCode !== null) throw Error("Renderer server exited");
			try {
				if ((await fetch(origin)).ok) break;
			} catch {}
			if (attempt === 99) throw Error("Renderer startup timed out");
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		environment.TUXEDO_RENDERER_ORIGIN = origin;
	}
	application = await launchApplication();
	let page = await application.firstWindow();
	// Loading the entry route resumes the backend's Active workspace, like a fresh launch.
	const reopen = () => page.goto(new URL("/", page.url()).href);
	await assertWindowState(page);
	await page.waitForFunction(() => typeof window.desktop?.readSession === "function");
	const confirmed = await page.evaluate(() => window.desktop.readSession({}));
	assert.equal(confirmed.session.status, "empty");
	assert.deepEqual(confirmed.session.catalogue.workspaces, []);
	await application.evaluate(({ dialog }) => {
		globalThis.originalOpenDialog = dialog.showOpenDialog;
		dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
	});
	try {
		assert.equal(await page.evaluate(() => window.desktop.selectTodoFile({})), null);
		await application.evaluate(({ dialog }) => {
			dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ["/tmp/chosen.todo"] });
		});
		assert.equal(await page.evaluate(() => window.desktop.selectTodoFile({})), "/tmp/chosen.todo");
	} finally {
		await application.evaluate(({ dialog }) => {
			dialog.showOpenDialog = globalThis.originalOpenDialog;
			delete globalThis.originalOpenDialog;
		});
	}
	console.log(
		"Todo-file dialog cancellation and selection pass through the admitted desktop bridge."
	);
	assert.equal(await page.evaluate(() => typeof window.require), "undefined");
	assert.equal(await page.evaluate(() => typeof window.process), "undefined");
	assert.equal(
		await page.evaluate(async () => {
			try {
				await window.desktop.readSession({ path: "/etc/passwd" });
				return false;
			} catch {
				return true;
			}
		}),
		true
	);
	await page.getByText("No workspace open", { exact: true }).waitFor();
	assert.equal(
		await page.locator("[data-slot='sidebar']").count(),
		0,
		"Home must not render workspace filters"
	);

	const preferences = await application.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
	);
	assert.equal(preferences.sandbox, true);
	assert.equal(preferences.contextIsolation, true);
	assert.equal(preferences.nodeIntegration, false);
	await assert.rejects(readFile(join(directory, "workspaces.json")), { code: "ENOENT" });
	await workspaceSetupWorkflow(application, page, directory);
	const todoPath = join(directory, "todo.txt");
	await writeFile(todoPath, "(A) Call Mom +Family @phone\nx 2026-07-10 Finished\n");
	let created = await page.evaluate((input) => window.desktop.createWorkspace(input), {
		name: "Personal",
		color: "green",
		todoPath,
	});
	assert.equal(created.status, "applied");
	assert.equal(created.confirmed.session.status, "ready");
	assert.equal(created.confirmed.session.todo_file.items.length, 2);
	assert.equal(created.confirmed.session.todo_file.items[0].description, "Call Mom");
	assert.deepEqual((await readConfirmation(page)).session, created.confirmed.session);
	const beforeUndo = await readFile(todoPath, "utf8");
	const sorted = await page.evaluate((input) => window.desktop.setWorkspaceSortOrder(input), {
		scope: created.confirmed.scope,
		revision: created.confirmed.revision,
		workspaceId: created.confirmed.session.catalogue.active_workspace_id,
		sortOrder: "due",
	});
	assert.equal(sorted.status, "applied");
	assert.equal(sorted.confirmed.session.catalogue.workspaces[0].sort_order, "due");
	assert.equal(await readFile(todoPath, "utf8"), beforeUndo);
	await page.addInitScript(() => {
		window.startupHomeSeen = false;
		new MutationObserver(() => {
			if (
				document.querySelector(
					'nav[aria-label="Saved workspaces"], [aria-label="No active workspace"], [aria-label="Loading workspace session"]'
				)
			)
				window.startupHomeSeen = true;
		}).observe(document, { childList: true, subtree: true });
	});
	await reopen();
	await page.getByRole("button", { name: "Sort Todo items", exact: true }).waitFor();
	assert.equal(
		await page.getByRole("link", { name: "Home", exact: true }).count(),
		0,
		"Daily navigation uses the Workspace switcher"
	);
	assert.equal(
		await page.evaluate(() => window.startupHomeSeen),
		false,
		"Restoring an Active workspace must never render Home"
	);

	assert.equal(
		await page.getByRole("button", { name: "Sort Todo items", exact: true }).getAttribute("title"),
		"Sort: Due date"
	);
	const restoredSort = await readConfirmation(page);
	const unsorted = await page.evaluate((input) => window.desktop.setWorkspaceSortOrder(input), {
		scope: restoredSort.scope,
		revision: restoredSort.revision,
		workspaceId: restoredSort.session.catalogue.active_workspace_id,
		sortOrder: "file",
	});
	assert.equal(unsorted.status, "applied");
	created = unsorted;
	console.log(
		"Workspace sort order persists through preload/IPC and renderer reload without changing the Todo file."
	);
	await page.evaluate((input) => window.desktop.createTodo(input), {
		scope: created.confirmed.scope,
		revision: created.confirmed.revision,
		workspaceId: created.confirmed.session.catalogue.active_workspace_id,
		description: "Undo bridge test",
		projects: [],
		contexts: [],
	});
	await reopen();
	const undoButton = page.getByRole("button", { name: "Undo creation", exact: true });
	await undoButton.waitFor();
	assert.equal(await undoButton.isEnabled(), true);
	await undoButton.click();
	await page.getByRole("button", { name: "Undo last change", exact: true }).waitFor();
	assert.equal(
		await page.getByRole("button", { name: "Undo last change", exact: true }).isDisabled(),
		true
	);
	assert.equal(await readFile(todoPath, "utf8"), beforeUndo);
	created = {
		status: "applied",
		confirmed: await readConfirmation(page),
	};
	await assert.rejects(
		page.evaluate((input) => window.desktop.undoTodo({ ...input, contents: "overwrite" }), {
			scope: created.confirmed.scope,
			revision: created.confirmed.revision,
			workspaceId: created.confirmed.session.catalogue.active_workspace_id,
		})
	);
	console.log(
		"Topbar Undo restores exact contents through preload/IPC and consumes its single slot."
	);
	const savedView = await page.evaluate((input) => window.desktop.saveView(input), {
		workspaceId: created.confirmed.session.catalogue.active_workspace_id,
		name: "Calls",
		filters: {
			status: "all",
			search: "Call",
			project: null,
			context: null,
			priority: null,
			due: null,
		},
	});
	assert.equal(savedView.status, "applied");
	assert.deepEqual(
		await page.evaluate(
			(workspaceId) => window.desktop.readSavedViews({ workspaceId }),
			savedView.workspaceId
		),
		savedView
	);
	await assert.rejects(
		page.evaluate((input) => window.desktop.saveView(input), {
			workspaceId: created.confirmed.session.catalogue.active_workspace_id,
			name: "Invalid",
			filters: {
				status: "open",
				search: "",
				project: null,
				context: null,
				priority: null,
				due: "tomorrow",
			},
		})
	);

	const createdTodo = await page.evaluate((input) => window.desktop.createTodo(input), {
		scope: created.confirmed.scope,
		revision: created.confirmed.revision,
		workspaceId: created.confirmed.session.catalogue.active_workspace_id,
		description: "Plan sprint",
		projects: ["Planning"],
		contexts: ["desk"],
		priority: "Z",
		creationDate: "2026-10-01",
		completed: true,
		completionDate: "2026-10-09",
		metadata: ["due:2026-10-10", "custom:value"],
	});
	assert.equal(createdTodo.status, "applied");
	assert.equal(createdTodo.confirmed.todo_file.items.at(-1).description, "Plan sprint");
	assert.deepEqual(createdTodo.confirmed.todo_file.items.at(-1).projects, ["Planning"]);
	assert.deepEqual(createdTodo.confirmed.todo_file.items.at(-1).contexts, ["desk"]);
	assert.match(
		await readFile(todoPath, "utf8"),
		/\nx 2026-10-09 2026-10-01 Plan sprint \+Planning @desk due:2026-10-10 custom:value pri:Z\n$/
	);
	assert.equal(createdTodo.confirmed.todo_file.items.at(-1).completed, true);
	assert.equal(createdTodo.confirmed.todo_file.items.at(-1).creation_date, "2026-10-01");
	assert.equal(createdTodo.confirmed.todo_file.items.at(-1).completion_date, "2026-10-09");
	assert.deepEqual(createdTodo.confirmed.todo_file.items.at(-1).metadata, {
		due: "2026-10-10",
		custom: "value",
		pri: "Z",
	});

	const invalidCreationRejected = await page.evaluate(async (confirmed) => {
		try {
			await window.desktop.createTodo({
				scope: confirmed.scope,
				revision: confirmed.revision,
				workspaceId: confirmed.workspaceId,
				description: "Invalid",
				projects: [],
				contexts: [],
				completed: true,
				completionDate: "2026-02-30",
				unexpected: true,
			});
			return false;
		} catch {
			return true;
		}
	}, createdTodo.confirmed);
	assert.equal(invalidCreationRejected, true);
	assert.equal((await readConfirmation(page)).revision, createdTodo.confirmed.revision);

	const rejected = await page.evaluate((input) => window.desktop.createWorkspace(input), {
		name: "Personal",
		color: "green",
		todoPath,
	});
	assert.equal(rejected.status, "rejected");
	assert.equal(
		await page.evaluate(async () => {
			try {
				await window.desktop.createWorkspace({
					name: "Bad",
					color: "invalid",
					todoPath: "/tmp/invalid",
				});
				return false;
			} catch {
				return true;
			}
		}),
		true
	);
	const secondPath = join(directory, "second.todo");
	await writeFile(secondPath, "Second item");
	await page.evaluate((input) => window.desktop.createWorkspace(input), {
		name: "Second",
		color: "blue",
		todoPath: secondPath,
	});
	const switched = await page.evaluate(
		(workspaceId) => window.desktop.switchWorkspace({ workspaceId }),
		created.confirmed.session.catalogue.active_workspace_id
	);
	assert.equal(switched.status, "applied");
	assert.equal(switched.confirmed.session.todo_file.items[0].description, "Call Mom");

	const beforeBulk = await readFile(todoPath, "utf8");
	const bulkSource = `${beforeBulk}Another open item\r\n`;
	await writeFile(todoPath, bulkSource);
	const bulkSession = await activateWorkspace(
		page,
		(await page.evaluate(() => window.desktop.readSession({}))).session.catalogue
			.active_workspace_id
	);
	const bulkTarget = {
		completed: true,
		scope: bulkSession.scope,
		revision: bulkSession.revision,
		workspaceId: bulkSession.session.catalogue.active_workspace_id,
		targets: bulkSession.session.todo_file.items.map((item) => ({
			lineNumber: item.line_number,
			expectedRaw: item.raw,
		})),
	};
	assert.equal(
		await page.evaluate(async (input) => {
			try {
				await window.desktop.bulkSetTodoCompletion({ ...input, targets: [] });
				return false;
			} catch {
				return true;
			}
		}, bulkTarget),
		true
	);
	const bulkCompleted = await page.evaluate(
		(input) => window.desktop.bulkSetTodoCompletion(input),
		bulkTarget
	);
	assert.equal(bulkCompleted.status, "applied");
	assert.equal(bulkCompleted.confirmed.todo_file.items.filter((item) => !item.completed).length, 0);
	assert.equal(bulkCompleted.confirmed.undoLabel, "Undo completion");
	const bulkUndone = await page.evaluate((input) => window.desktop.undoTodo(input), {
		scope: bulkCompleted.confirmed.scope,
		revision: bulkCompleted.confirmed.revision,
		workspaceId: bulkCompleted.confirmed.workspaceId,
	});
	assert.equal(bulkUndone.status, "applied");
	assert.equal(await readFile(todoPath, "utf8"), bulkSource);
	const bulkReopened = await page.evaluate((input) => window.desktop.bulkSetTodoCompletion(input), {
		...bulkTarget,
		completed: false,
		revision: bulkUndone.confirmed.revision,
		targets: bulkUndone.confirmed.todo_file.items.map((item) => ({
			lineNumber: item.line_number,
			expectedRaw: item.raw,
		})),
	});
	assert.equal(bulkReopened.status, "applied");
	assert.equal(
		bulkReopened.confirmed.todo_file.items.some((item) => item.completed),
		false
	);
	assert.equal(bulkReopened.confirmed.undoLabel, "Undo uncompletion");
	const reopeningUndone = await page.evaluate((input) => window.desktop.undoTodo(input), {
		scope: bulkReopened.confirmed.scope,
		revision: bulkReopened.confirmed.revision,
		workspaceId: bulkReopened.confirmed.workspaceId,
	});
	assert.equal(reopeningUndone.status, "applied");
	assert.equal(await readFile(todoPath, "utf8"), bulkSource);
	await writeFile(todoPath, beforeBulk);
	switched.confirmed = await activateWorkspace(
		page,
		(await page.evaluate(() => window.desktop.readSession({}))).session.catalogue
			.active_workspace_id
	);

	const completionTarget = {
		scope: switched.confirmed.scope,
		revision: switched.confirmed.revision,
		workspaceId: switched.confirmed.session.catalogue.active_workspace_id,
		lineNumber: 1,
		expectedRaw: switched.confirmed.session.todo_file.items[0].raw,
		completed: true,
	};
	const completed = await page.evaluate(
		(input) => window.desktop.setTodoCompletion(input),
		completionTarget
	);
	assert.equal(completed.status, "applied");
	assert.equal(completed.confirmed.todo_file.items[0].completed, true);
	assert.match(
		await readFile(todoPath, "utf8"),
		/^x \d{4}-\d{2}-\d{2} Call Mom \+Family @phone pri:A\n/
	);
	const uncompleted = await page.evaluate((input) => window.desktop.setTodoCompletion(input), {
		...completionTarget,
		revision: completed.confirmed.revision,
		expectedRaw: completed.confirmed.todo_file.items[0].raw,
		completed: false,
	});
	assert.equal(uncompleted.status, "applied");
	assert.equal(uncompleted.confirmed.todo_file.items[0].raw, "(A) Call Mom +Family @phone");
	await writeFile(todoPath, "Externally changed\nx 2026-07-10 Finished\n");
	const conflict = await page.evaluate((input) => window.desktop.setTodoCompletion(input), {
		...completionTarget,
		revision: uncompleted.confirmed.revision,
	});
	assert.equal(conflict.status, "conflict");
	assert.equal(conflict.confirmed.todo_file.items[0].raw, "Externally changed");
	await writeFile(todoPath, "(A) Call Mom +Family @phone\nx 2026-07-10 Finished\n");
	await activateWorkspace(
		page,
		(await page.evaluate(() => window.desktop.readSession({}))).session.catalogue
			.active_workspace_id
	);
	const missing = await page.evaluate(() =>
		window.desktop.switchWorkspace({ workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })
	);
	assert.equal(missing.status, "rejected");
	await reopen();
	await page.getByText("Call Mom", { exact: true }).waitFor();
	await application.close();
	application = await launchApplication();
	page = await application.firstWindow();
	await assertWindowState(page);
	await page.getByText("Call Mom", { exact: true }).waitFor();
	const restored = await readConfirmation(page);
	assert.equal(
		restored.session.catalogue.active_workspace_id,
		created.confirmed.session.catalogue.active_workspace_id
	);
	assert.deepEqual(
		restored.session.catalogue.workspaces.map((workspace) => workspace.name),
		["Personal", "Second"]
	);
	assert.deepEqual(
		await page.evaluate(
			(workspaceId) => window.desktop.readSavedViews({ workspaceId }),
			savedView.workspaceId
		),
		savedView
	);

	// Stable session reads preserve Undo and the renderer's editing target.
	await page.getByRole("checkbox", { name: "Mark Call Mom complete", exact: true }).click();
	await page.getByRole("button", { name: "Undo completion", exact: true }).waitFor();
	const beforeReads = await readConfirmation(page);
	for (let n = 0; n < 2; n++) assert.deepEqual(await readConfirmation(page), beforeReads);
	await assert.rejects(page.evaluate(() => window.desktop.readSession({ path: "/etc/passwd" })));
	await page.getByRole("button", { name: "Undo completion", exact: true }).click();
	await page.getByRole("checkbox", { name: "Mark Call Mom complete", exact: true }).waitFor();
	console.log("Repeated session reads preserve selection, revision and Undo.");

	// Real observation signals cross preload/IPC and invalidate the displayed Todo file.
	await writeFile(
		todoPath,
		"(B) External insertion +Observed @desk\nx 2026-10-10 Finished\n2026-13-01 Invalid\n"
	);
	await page.getByText("External insertion", { exact: true }).waitFor();
	await page.getByText("Todo file reloaded", { exact: true }).waitFor();
	assert.equal(await page.locator('[data-sonner-toast][data-type="info"]').count(), 1);
	assert.equal(await page.locator('[data-sonner-toast][data-type="error"]').count(), 0);
	assert.match(await page.getByLabel("Reader status").textContent(), /1 skipped line/);
	await page.getByRole("button", { name: /^All\s*2$/ }).waitFor();
	await page.getByRole("button", { name: /^Open\s*1$/ }).waitFor();
	await page.getByRole("button", { name: /^Completed\s*1$/ }).waitFor();
	assert.match(
		await page.getByRole("button", { name: "+Observed", exact: true }).textContent(),
		/1/
	);
	assert.match(await page.getByRole("button", { name: "@desk", exact: true }).textContent(), /1/);
	await page.getByRole("button", { name: "Priority B", exact: true }).waitFor();
	const observed = await readConfirmation(page);
	assert.deepEqual(observed.session.todo_file.items[0].projects, ["Observed"]);
	await writeFile(
		todoPath,
		"(B) External insertion +Observed @desk\nx 2026-10-10 Finished\n2026-13-01 Invalid\n\n"
	);
	await page.waitForFunction(
		async (revision) => (await window.desktop.readSession({})).revision > revision,
		observed.revision
	);
	assert.equal(
		await page.locator('[data-sonner-toast][data-type="info"]').count(),
		1,
		"Equivalent save must not add a notice"
	);
	await writeFile(todoPath, "(A) Call Mom +Family @phone\nx 2026-07-10 Finished\n");
	await page.getByText("Call Mom", { exact: true }).waitFor();
	console.log(
		"Todo-file observation: external edit, items, counts, facets, skipped lines, preload signal, and equivalent-save notice checks passed."
	);
	const deleted = await page.evaluate(
		(workspaceId) => window.desktop.deleteWorkspace({ workspaceId }),
		created.confirmed.session.catalogue.active_workspace_id
	);
	assert.equal(deleted.status, "applied");
	assert.equal(deleted.confirmed.session.status, "empty");
	assert.equal(deleted.confirmed.session.catalogue.active_workspace_id, null);
	assert.equal(deleted.confirmed.session.catalogue.workspaces.length, 1);
	assert.equal(deleted.confirmed.session.catalogue.workspaces[0].name, "Second");
	assert.equal(
		await readFile(todoPath, "utf8"),
		"(A) Call Mom +Family @phone\nx 2026-07-10 Finished\n"
	);
	assert.deepEqual(
		JSON.parse(await readFile(join(directory, "workspaces.json"), "utf8")).workspaces.map(
			(workspace) => workspace.name
		),
		["Second"]
	);

	const untrustedReadErrors = await application.evaluate(async ({ BrowserWindow, app }) => {
		const untrusted = new BrowserWindow({
			show: false,
			webPreferences: {
				preload: `${app.getAppPath()}/${app.isPackaged ? "dist-electron/" : ""}preload.cjs`,
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
		try {
			await untrusted.loadURL("about:blank");
			return await untrusted.webContents.executeJavaScript(`Promise.all([
				window.desktop.readSession({}),
				window.desktop.readSavedViews({ workspaceId: "550e8400-e29b-41d4-a716-446655440000" })
			].map((request) => request.then(() => "accepted", (error) => error.message)))`);
		} finally {
			untrusted.destroy();
		}
	});
	assert.equal(untrustedReadErrors.length, 2);
	for (const error of untrustedReadErrors) assert.match(error, /Untrusted desktop sender/);

	// Exercise the sandboxed preload's response and event validators with main-supplied data.
	await application.evaluate(({ ipcMain }) => {
		ipcMain.removeHandler("tuxedo:select-todo-file");
		ipcMain.handle("tuxedo:select-todo-file", () => ({ path: "/tmp/unexpected" }));
	});
	assert.equal(
		await page.evaluate(async () => {
			try {
				await window.desktop.selectTodoFile({});
				return false;
			} catch {
				return true;
			}
		}),
		true
	);
	await application.evaluate(({ ipcMain }) => {
		globalThis.originalSessionRead = ipcMain._invokeHandlers.get("tuxedo:read-session");
		ipcMain.removeHandler("tuxedo:read-session");
		ipcMain.handle("tuxedo:read-session", () => ({ scope: "invalid", revision: -1 }));
	});
	await assert.rejects(page.evaluate(() => window.desktop.readSession({})));
	await application.evaluate(({ ipcMain }) => {
		ipcMain.removeHandler("tuxedo:read-session");
		ipcMain.handle("tuxedo:read-session", globalThis.originalSessionRead);
		delete globalThis.originalSessionRead;
	});
	const signal = {
		scope: "9426bd98-a6dd-48eb-b1ab-037d82983ae1",
		revision: 0,
		workspaceId: "550e8400-e29b-41d4-a716-446655440000",
		todoPath: "/tmp/validation.todo",
	};

	await page.evaluate(() => {
		window.validationSignals = [];
		window.validationSignalReceived = new Promise((resolve) => {
			const unsubscribe = window.desktop.onTodoFileChanged((event) => {
				window.validationSignals.push(event);
				if (event.todoPath === "/tmp/validation.todo") {
					unsubscribe();
					resolve();
				}
			});
		});
	});
	await application.evaluate(({ BrowserWindow }, valid) => {
		const contents = BrowserWindow.getAllWindows()[0].webContents;
		for (const invalid of [
			null,
			{ ...valid, revision: -1 },
			{ ...valid, scope: "invalid" },
			{ ...valid, unexpected: true },
		])
			contents.send("tuxedo:todo-file-changed", invalid);
		contents.send("tuxedo:todo-file-changed", valid);
	}, signal);
	assert.deepEqual(
		await page.evaluate(async () => {
			await window.validationSignalReceived;
			return window.validationSignals;
		}),
		[signal]
	);
	console.log(
		"Sandboxed preload rejects malformed responses and discards malformed observation events."
	);

	await rpcWorkflow(application, page, directory);

	const routeIds = {};
	for (const [name, item] of [
		["Route A", "Alpha item"],
		["Route B", "Beta item"],
	]) {
		const routePath = join(directory, `${name.replace(" ", "-")}.txt`);
		await writeFile(routePath, `${item}\n`);
		const routed = await page.evaluate((input) => window.desktop.createWorkspace(input), {
			name,
			color: "violet",
			todoPath: routePath,
		});
		routeIds[name] = routed.confirmed.session.catalogue.active_workspace_id;
	}
	const routeUrl = (path) => new URL(path, page.url()).href;
	const recoverHome = async () => {
		await page.goto(routeUrl("/workspaces/00000000-0000-4000-8000-000000000000"));
		await page.waitForURL(routeUrl("/"));
		await page.getByLabel("Workspace home", { exact: true }).waitFor();
	};
	const activeId = async () =>
		(await page.evaluate(() => window.desktop.readSession({}))).session.catalogue
			.active_workspace_id;
	const expectRoute = async (name, item) => {
		await page.waitForURL(routeUrl(`/workspaces/${routeIds[name]}`));
		await page.getByText(item, { exact: true }).waitFor();
		assert.equal(await activeId(), routeIds[name]);
	};
	await reopen();
	await expectRoute("Route B", "Beta item");
	await kanbanRoutingWorkflow(application, page, routeIds, routeUrl, activeId, expectRoute);
	await recoverHome();
	await page.waitForURL(routeUrl("/"));
	await page.getByRole("navigation", { name: "Saved workspaces" }).waitFor();
	assert.equal(await page.locator("[data-slot='sidebar']").count(), 0);
	assert.equal(await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).count(), 0);
	assert.equal(await activeId(), routeIds["Route B"], "Home preserves the Active workspace");
	const createdPath = join(directory, "Route-C.txt");
	await writeFile(createdPath, "Gamma item\n");
	await application.evaluate(({ ipcMain }, path) => {
		ipcMain.removeHandler("tuxedo:select-todo-file");
		ipcMain.handle("tuxedo:select-todo-file", () => path);
	}, createdPath);
	await page.getByRole("button", { name: "New workspace", exact: true }).click();
	await page.getByRole("textbox", { name: "Workspace name" }).fill("Route C");
	await page.getByRole("button", { name: "Open an existing Todo file", exact: true }).click();
	await page.getByText(createdPath, { exact: true }).waitFor();
	await page.getByRole("button", { name: "Create workspace", exact: true }).click();
	await page.getByText("Gamma item", { exact: true }).waitFor();
	routeIds["Route C"] = await activeId();
	await expectRoute("Route C", "Gamma item");
	await recoverHome();
	await page.getByRole("link", { name: "Route A", exact: true }).click();
	await expectRoute("Route A", "Alpha item");
	await page.getByRole("button", { name: "Select workspace: Route A" }).click();
	await page.getByRole("menuitem", { name: "Route B", exact: true }).click();
	await expectRoute("Route B", "Beta item");
	const historyLength = await page.evaluate(() => history.length);
	await page.goBack();
	await expectRoute("Route A", "Alpha item");
	await page.goForward();
	await expectRoute("Route B", "Beta item");
	assert.equal(await page.evaluate(() => history.length), historyLength);
	console.log(
		"Home, picker, creation, switcher, Back and Forward switch the persisted Active workspace."
	);

	await page.getByRole("checkbox", { name: "Mark Beta item complete", exact: true }).click();
	const routeUndo = page.getByRole("button", { name: "Undo completion", exact: true });
	await routeUndo.waitFor();
	await recoverHome();
	await page.getByRole("link", { name: "Route B", exact: true }).click();
	await expectRoute("Route B", "Beta item");
	assert.ok(await routeUndo.isEnabled(), "Returning from Home keeps Undo");
	await page.getByRole("button", { name: "Select workspace: Route B" }).click();
	await page.getByRole("menuitem", { name: "Route A", exact: true }).click();
	await expectRoute("Route A", "Alpha item");
	await page.goBack();
	await expectRoute("Route B", "Beta item");
	await page.getByRole("button", { name: "Undo last change", exact: true }).waitFor();
	console.log("Home keeps the Undo opportunity; history switches clear it.");

	await reopen();
	await expectRoute("Route B", "Beta item");
	// A kept startup entry would make Back stop at the picker.
	await page.goBack();
	await expectRoute("Route B", "Beta item");
	await page.goto(routeUrl(`/workspaces/${routeIds["Route A"]}`));
	await expectRoute("Route A", "Alpha item");
	await page.reload();
	await expectRoute("Route A", "Alpha item");
	await recoverHome();
	assert.equal(await activeId(), routeIds["Route A"], "A failed switch keeps the session");
	await page.getByText("Workspace unavailable", { exact: true }).waitFor();
	assert.equal(await page.getByText("Alpha item", { exact: true }).count(), 0);
	assert.equal(await page.locator("[data-slot='sidebar']").count(), 0);
	await page.reload();
	await expectRoute("Route A", "Alpha item");
	console.log(
		"Unavailable nested destinations recover on Home; reload resumes the confirmed Active workspace."
	);

	await rm(join(directory, "Route-A.txt"));
	await page.waitForURL(routeUrl("/"));
	await page.getByLabel("Workspace home", { exact: true }).waitFor();
	await page.getByText("Workspace unavailable", { exact: true }).waitFor();
	await page
		.getByText("This Todo file couldn’t be found. It may have been moved or deleted.", {
			exact: true,
		})
		.waitFor();
	assert.equal(await page.getByText("Alpha item", { exact: true }).count(), 0);
	assert.equal(await page.locator("[data-slot='sidebar']").count(), 0);
	await writeFile(join(directory, "Route-A.txt"), "Alpha item\n");
	await page.getByRole("link", { name: "Route A", exact: true }).click();
	await expectRoute("Route A", "Alpha item");
	console.log(
		"An unreadable Todo file returns to Home and can be reopened from its row after recovery."
	);
	await application.evaluate(({ ipcMain }) => {
		ipcMain.removeHandler("tuxedo:switch-workspace");
		ipcMain.handle(
			"tuxedo:switch-workspace",
			() => new Promise((resolve) => (globalThis.releaseSwitch = resolve))
		);
	});
	await page.getByRole("button", { name: "Select workspace: Route A" }).click();
	await page.getByRole("menuitem", { name: "Route B", exact: true }).click();
	await page.getByLabel("Opening workspace", { exact: true }).waitFor();
	const pendingUrl = page.url();
	await page.evaluate(
		() =>
			new Promise((resolve) => {
				window.addEventListener("popstate", resolve, { once: true });
				history.back();
			})
	);
	await page.waitForURL(pendingUrl);
	assert.equal(page.url(), pendingUrl, "Back is blocked during a Workspace session operation");
	assert.equal(await page.getByText("Alpha item", { exact: true }).count(), 0);
	await application.evaluate(() =>
		globalThis.releaseSwitch({ status: "rejected", message: "Held switch failed" })
	);
	await page.getByText("Held switch failed", { exact: true }).waitFor();
	assert.equal(await activeId(), routeIds["Route A"]);
	await page.waitForURL(routeUrl("/"));
	await page.getByLabel("Workspace home", { exact: true }).waitFor();
	assert.equal(await page.locator("[data-slot='sidebar']").count(), 0);
	console.log(
		"Navigation waits for admitted operations; failed switches recover on Home and retain the session."
	);
	await page.getByRole("navigation", { name: "Saved workspaces" }).waitFor();
	const removeFromHome = async (name, cancel = false) => {
		await page.getByRole("button", { name: `Options for ${name}`, exact: true }).click();
		const removal = page.getByRole("menuitem", { name: "Remove workspace", exact: true });
		await removal.click();
		const confirmation = page.getByRole("alertdialog");
		await confirmation.waitFor();
		assert.match(
			await confirmation.innerText(),
			new RegExp(`Remove ${name} from saved Workspaces`)
		);
		assert.equal(new URL(page.url()).pathname, "/", "Options must not open the Workspace");
		await confirmation
			.getByRole("button", { name: cancel ? "Cancel" : "Remove workspace", exact: true })
			.click();
		await confirmation.waitFor({ state: "hidden" });
		if (!cancel) await page.getByRole("link", { name, exact: true }).waitFor({ state: "hidden" });
	};
	await removeFromHome("Route C", true);
	assert.equal(await page.getByRole("link", { name: "Route C", exact: true }).count(), 1);
	assert.equal(await activeId(), routeIds["Route A"]);
	await removeFromHome("Route C");
	assert.equal(await readFile(createdPath, "utf8"), "Gamma item\n");
	assert.equal(
		await activeId(),
		routeIds["Route A"],
		"Removing an inactive Workspace keeps the active one"
	);
	await removeFromHome("Route A");
	assert.equal(await activeId(), null);
	assert.equal(await readFile(join(directory, "Route-A.txt"), "utf8"), "Alpha item\n");
	await page.reload();
	await page.getByRole("navigation", { name: "Saved workspaces" }).waitFor();
	assert.equal(await page.getByRole("link", { name: "Route A", exact: true }).count(), 0);
	assert.equal(await page.getByRole("link", { name: "Route C", exact: true }).count(), 0);
	assert.equal(await page.locator("[data-slot='sidebar']").count(), 0);
	console.log(
		"Home Workspace options cancel or remove active/inactive references without navigating or deleting Todo files."
	);

	console.log(
		"Real Electron preload/IPC lifecycle, completion, deletion, conflicts, and isolation checks passed."
	);
	const exited = once(application.process(), "exit", { signal: AbortSignal.timeout(15000) });
	await application.evaluate(({ app }) => {
		app.quit();
	});
	assert.equal((await exited)[0], 0, "Normal quit must complete cleanup and exit successfully");
	application = undefined;
	console.log("Real Electron normal quit drained and exited successfully.");
	application = await launchApplication();
	const stuckPage = await application.firstWindow();
	await stuckPage.waitForFunction(() => typeof window.desktop?.selectTodoFile === "function");
	await application.evaluate(({ dialog }) => {
		let entered;
		globalThis.dialogEntered = new Promise((resolve) => (entered = resolve));
		dialog.showOpenDialog = () => {
			entered();
			return new Promise(() => {});
		};
	});
	await stuckPage.evaluate(() => {
		void window.desktop.selectTodoFile({}).catch(() => {});
	});
	await application.evaluate(async () => {
		await globalThis.dialogEntered;
	});
	let shutdownDiagnostic = "";
	application.process().stderr.setEncoding("utf8");
	application.process().stderr.on("data", (chunk) => {
		shutdownDiagnostic += chunk;
	});
	const forcedExit = once(application.process(), "exit", { signal: AbortSignal.timeout(15000) });
	await application.evaluate(({ app }) => {
		app.quit();
		app.quit();
	});
	assert.equal((await forcedExit)[0], 1, "A stuck dialog must reach the bounded quit fallback");
	assert.match(shutdownDiagnostic, /Application shutdown deadline exceeded/);
	assert.match(shutdownDiagnostic, /selectTodoFile/);
	application = undefined;
	console.log(
		"Real Electron stuck-dialog quit reached the 10-second fallback with pending-operation diagnostics."
	);
	const failed = spawn(electronPath, [resolve("dist-electron/main.js")], {
		env: { ...environment, TUXEDO_RENDERER_ORIGIN: "http://127.0.0.1:1" },
		stdio: ["ignore", "ignore", "pipe"],
	});
	let diagnostic = "";
	failed.stderr.setEncoding("utf8");
	failed.stderr.on("data", (chunk) => {
		diagnostic += chunk;
	});
	try {
		const [code] = await once(failed, "exit", { signal: AbortSignal.timeout(15000) });
		assert.equal(code, 1, diagnostic);
		assert.match(diagnostic, /Desktop startup failed/);
		assert.doesNotMatch(diagnostic, /shutdown deadline exceeded/);
	} finally {
		if (failed.exitCode === null && failed.signalCode === null) failed.kill();
	}
	console.log("Real Electron renderer startup failure cleaned up and exited with a diagnostic.");
} finally {
	try {
		await application?.close();
	} finally {
		try {
			if (vite && vite.exitCode === null && vite.signalCode === null) {
				const exited = once(vite, "exit", { signal: AbortSignal.timeout(5000) });
				vite.kill();
				await exited;
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
}
