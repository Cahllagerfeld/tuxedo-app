import { _electron as electron } from "playwright";
import electronPath from "electron";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const directory = await mkdtemp(join(tmpdir(), "tuxedo-electron-deletion-"));
let application;
try {
	application = await electron.launch({
		timeout: 20000,
		executablePath: process.env.TUXEDO_PACKAGED_EXECUTABLE ?? electronPath,
		args: process.env.TUXEDO_PACKAGED_EXECUTABLE ? [] : [resolve("dist-electron/main.js")],
		env: { ...process.env, TUXEDO_USER_DATA: directory },
	});
	const page = await application.firstWindow();
	await page.waitForFunction(() => typeof window.desktop?.deleteTodo === "function");
	const todoPath = join(directory, "todo.txt");
	await writeFile(todoPath, "First +Work\r\nx 2026-07-10 Finished +Home");
	const created = await page.evaluate((input) => window.desktop.createWorkspace(input), {
		name: "Personal",
		color: "blue",
		todoPath,
	});
	assert.equal(created.status, "applied");
	const request = {
		scope: created.confirmed.scope,
		revision: created.confirmed.revision,
		workspaceId: created.confirmed.session.catalogue.active_workspace_id,
		lineNumber: 2,
		expectedRaw: "x 2026-07-10 Finished +Home",
	};
	const deleted = await page.evaluate((input) => window.desktop.deleteTodo(input), request);
	assert.equal(deleted.status, "applied");
	assert.equal(deleted.confirmed.workspaceId, request.workspaceId);
	assert.deepEqual(
		deleted.confirmed.todo_file.items.map((item) => item.description),
		["First"]
	);
	assert.equal(await readFile(todoPath, "utf8"), "First +Work\r\n");
	await writeFile(todoPath, "Changed externally\r\n");
	const conflict = await page.evaluate((input) => window.desktop.deleteTodo(input), {
		...request,
		revision: deleted.confirmed.revision,
		lineNumber: 1,
		expectedRaw: "First +Work",
	});
	assert.equal(conflict.status, "conflict");
	assert.equal(conflict.confirmed.todo_file.items[0].description, "Changed externally");
	assert.equal(await readFile(todoPath, "utf8"), "Changed externally\r\n");
	console.log("Real Electron Todo-item deletion and current-file conflict checks passed.");
} finally {
	await application?.close();
	await rm(directory, { recursive: true, force: true });
}
