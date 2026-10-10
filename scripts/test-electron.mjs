import { _electron as electron } from "playwright";
import electronPath from "electron";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
const development = process.argv.includes("--dev");
const packagedExecutable = process.env.TUXEDO_PACKAGED_EXECUTABLE;
if (development && packagedExecutable) throw Error("Development tests require unpackaged Electron");
const directory = await mkdtemp(join(tmpdir(), "tuxedo-electron-"));
let application;
let vite;
const environment = { ...process.env, TUXEDO_USER_DATA: directory };
if (!packagedExecutable) delete environment.TUXEDO_RENDERER_ORIGIN;
const launchApplication = () =>
	electron.launch({
		timeout: 20000,
		executablePath: packagedExecutable ?? electronPath,
		args: packagedExecutable ? [] : [resolve("dist-electron/main.js")],
		env: environment,
	});
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
	await page.waitForFunction(() => typeof window.desktop?.readSession === "function");
	const confirmed = await page.evaluate(() => window.desktop.readSession({}));
	assert.equal(confirmed.session.status, "empty");
	assert.deepEqual(confirmed.session.catalogue.workspaces, []);
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

	// The inset shell gives the Todo file more room when navigation is collapsed.
	const sidebarToggle = page.getByRole("button", { name: "Toggle Sidebar", exact: true });
	await sidebarToggle.waitFor({ timeout: 5000 });
	const expandedWidth = (await page.getByRole("main").boundingBox()).width;
	await sidebarToggle.click();
	await page.waitForFunction(
		(width) => document.querySelector("main").getBoundingClientRect().width > width + 100,
		expandedWidth
	);
	await page.getByText("No workspace open", { exact: true }).waitFor();
	// Collapsed navigation must not leave keyboard focus on offscreen controls.
	await sidebarToggle.focus();
	await page.keyboard.press("Shift+Tab");
	const focusedLeft = await page.evaluate(
		() => document.activeElement.getBoundingClientRect().left
	);
	assert.ok(focusedLeft >= 0, "Collapsed sidebar navigation must be excluded from keyboard focus");
	await sidebarToggle.click();
	await page.waitForFunction(
		(width) => Math.abs(document.querySelector("main").getBoundingClientRect().width - width) < 2,
		expandedWidth
	);

	const preferences = await application.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
	);
	assert.equal(preferences.sandbox, true);
	assert.equal(preferences.contextIsolation, true);
	assert.equal(preferences.nodeIntegration, false);
	await assert.rejects(readFile(join(directory, "workspaces.json")), { code: "ENOENT" });
	const todoPath = join(directory, "todo.txt");
	await writeFile(todoPath, "(A) Call Mom +Family @phone\nx 2026-07-10 Finished\n");
	const created = await page.evaluate((input) => window.desktop.createWorkspace(input), {
		name: "Personal",
		color: "green",
		todoPath,
	});
	assert.equal(created.status, "applied");
	assert.equal(created.confirmed.session.status, "ready");
	assert.equal(created.confirmed.session.todo_file.items.length, 2);
	assert.equal(created.confirmed.session.todo_file.items[0].description, "Call Mom");
	assert.deepEqual(
		(await page.evaluate(() => window.desktop.readSession({}))).session,
		created.confirmed.session
	);
	const createdTodo = await page.evaluate((input) => window.desktop.createTodo(input), {
		scope: created.confirmed.scope,
		revision: created.confirmed.revision,
		workspaceId: created.confirmed.session.catalogue.active_workspace_id,
		description: "Plan sprint",
		projects: ["Planning"],
		contexts: ["desk"],
	});
	assert.equal(createdTodo.status, "applied");
	assert.equal(createdTodo.confirmed.todo_file.items.at(-1).description, "Plan sprint");
	assert.deepEqual(createdTodo.confirmed.todo_file.items.at(-1).projects, ["Planning"]);
	assert.deepEqual(createdTodo.confirmed.todo_file.items.at(-1).contexts, ["desk"]);
	assert.match(
		await readFile(todoPath, "utf8"),
		/\n\d{4}-\d{2}-\d{2} Plan sprint \+Planning @desk\n$/
	);
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
	assert.match(await readFile(todoPath, "utf8"), /^x \d{4}-\d{2}-\d{2} \(A\) Call Mom/);
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
	await page.evaluate(() => window.desktop.restoreSession({}));
	const missing = await page.evaluate(() =>
		window.desktop.switchWorkspace({ workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })
	);
	assert.equal(missing.status, "rejected");
	await page.reload();
	await page.getByText("Call Mom", { exact: true }).waitFor();
	await application.close();
	application = await launchApplication();
	page = await application.firstWindow();
	await page.getByText("Call Mom", { exact: true }).waitFor();
	const restored = await page.evaluate(() => window.desktop.readSession({}));
	assert.equal(
		restored.session.catalogue.active_workspace_id,
		created.confirmed.session.catalogue.active_workspace_id
	);
	assert.deepEqual(
		restored.session.catalogue.workspaces.map((workspace) => workspace.name),
		["Personal", "Second"]
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
	const deletionPath = join(directory, "deletion.todo");
	await writeFile(deletionPath, "First +Work\r\nx 2026-07-10 Finished +Home");
	const deletionWorkspace = await page.evaluate((input) => window.desktop.createWorkspace(input), {
		name: "Deletion",
		color: "blue",
		todoPath: deletionPath,
	});
	assert.equal(deletionWorkspace.status, "applied");
	const deletionTarget = {
		scope: deletionWorkspace.confirmed.scope,
		revision: deletionWorkspace.confirmed.revision,
		workspaceId: deletionWorkspace.confirmed.session.catalogue.active_workspace_id,
		lineNumber: 2,
		expectedRaw: "x 2026-07-10 Finished +Home",
	};
	const itemDeleted = await page.evaluate(
		(input) => window.desktop.deleteTodo(input),
		deletionTarget
	);
	assert.equal(itemDeleted.status, "applied");
	assert.equal(itemDeleted.confirmed.workspaceId, deletionTarget.workspaceId);
	assert.deepEqual(
		itemDeleted.confirmed.todo_file.items.map((item) => item.description),
		["First"]
	);
	assert.equal(await readFile(deletionPath, "utf8"), "First +Work\r\n");
	await writeFile(deletionPath, "Changed externally\r\n");
	const deletionConflict = await page.evaluate((input) => window.desktop.deleteTodo(input), {
		...deletionTarget,
		revision: itemDeleted.confirmed.revision,
		lineNumber: 1,
		expectedRaw: "First +Work",
	});
	assert.equal(deletionConflict.status, "conflict");
	assert.equal(deletionConflict.confirmed.todo_file.items[0].description, "Changed externally");
	assert.equal(await readFile(deletionPath, "utf8"), "Changed externally\r\n");

	// Exercise appearance with enough real Todo items to overflow the reader.
	await writeFile(
		deletionPath,
		Array.from({ length: 80 }, (_, index) => `Item ${index + 1}`).join("\n")
	);
	await page.reload();
	await page.getByText("Item 80", { exact: true }).waitFor();
	const switcher = page.getByRole("button", { name: "Select workspace: Deletion" });
	await switcher.hover();
	await page.waitForTimeout(250); // Allow the button's color transition to settle.
	const hoverContrast = await switcher.evaluate((element) => {
		const background = getComputedStyle(element).backgroundColor;
		const sidebar = getComputedStyle(
			element.closest('[data-slot="sidebar-inner"]')
		).backgroundColor;
		return background !== "rgba(0, 0, 0, 0)" && background !== sidebar;
	});
	const reader = page.getByLabel("Todo item results", { exact: true });
	await reader.hover();
	const thumb = reader.locator('[data-slot="scroll-area-thumb"]');
	await thumb.waitFor({ state: "visible" });
	const thumbVisible = await thumb.isVisible();
	assert.ok(
		hoverContrast && thumbVisible,
		`Workspace hover contrast: ${hoverContrast}; ScrollArea thumb visible: ${thumbVisible}`
	);
	const viewport = reader.locator('[data-slot="scroll-area-viewport"]');
	await viewport.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await page.waitForFunction(
		() =>
			document.querySelector('[aria-label="Todo item results"] [data-slot="scroll-area-viewport"]')
				.scrollTop > 0
	);
	assert.ok(await page.getByText("Item 80", { exact: true }).isVisible());
	console.log(
		"Real Electron preload/IPC lifecycle, completion, deletion, conflicts, and isolation checks passed."
	);
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
