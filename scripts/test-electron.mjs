import { _electron as electron } from "playwright";
import electronPath from "electron";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const directory = await mkdtemp(join(tmpdir(), "tuxedo-electron-"));
let application;
try {
	application = await electron.launch({
		timeout: 20000,
		executablePath: electronPath,
		args: [resolve("dist-electron/main.js")],
		env: { ...process.env, TUXEDO_USER_DATA: directory },
	});
	const page = await application.firstWindow();
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
	const missing = await page.evaluate(() =>
		window.desktop.switchWorkspace({ workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })
	);
	assert.equal(missing.status, "rejected");
	await page.reload();
	await page.getByText("Call Mom", { exact: true }).waitFor();
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
	console.log(
		"Real Electron preload/IPC creation, loaded Todo file, runtime validation, and isolation checks passed."
	);
} finally {
	await application?.close();
	await rm(directory, { recursive: true, force: true });
}
