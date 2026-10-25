import { panelWorkflow } from "./panel-workflow.mjs";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { listPackage } from "@electron/asar";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "tuxedo-packaged-"));
const bundle = join(directory, "Tuxedo.app");
const executablePath = join(bundle, "Contents/MacOS/Tuxedo");
const visible = process.argv.includes("--visible");
const packageEnv = { ...process.env };
delete packageEnv.NODE_PATH;
delete packageEnv.NODE_OPTIONS;
delete packageEnv.ELECTRON_RUN_AS_NODE;
let application;
try {
	await cp(resolve(`out/Tuxedo-darwin-${process.arch}/Tuxedo.app`), bundle, {
		recursive: true,
		verbatimSymlinks: true,
	});
	const entries = listPackage(join(bundle, "Contents/Resources/app.asar"));
	assert(entries.includes("/build/index.html"));
	assert(entries.includes("/dist-electron/main.js"));
	assert(entries.includes("/dist-electron/preload.cjs"));
	assert(
		!entries.some((path) => path.startsWith("/node_modules/")),
		"Runtime packages are bundled"
	);
	assert(
		entries.every((path) => /^\/(build|dist-electron|package\.json|node_modules)(\/|$)/.test(path))
	);
	application = await electron.launch({
		executablePath,
		args: [],
		cwd: directory,
		env: {
			...packageEnv,
			TUXEDO_USER_DATA: directory,
			TUXEDO_TEST_HIDDEN: visible ? "0" : "1",
			TUXEDO_RENDERER_ORIGIN: "http://127.0.0.1:1",
		},
		timeout: 20000,
	});
	const page = await application.firstWindow();
	page.setDefaultTimeout(10000);
	console.log("Packaged initial URL:", page.url());
	await page.getByText("No workspace open", { exact: true }).waitFor();
	assert.equal(
		await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
		visible
	);
	assert.equal(page.url(), "tuxedo://app/");
	assert.equal(await application.evaluate(({ app }) => app.isPackaged), true);
	const route = await page.goto("tuxedo://app/projects/Work");
	assert.equal(route.status(), 200);
	await page.getByText("Not Found", { exact: true }).waitFor();
	await page.reload();
	await page.getByText("Not Found", { exact: true }).waitFor();
	await page.goto("tuxedo://app/");
	await page.getByText("No workspace open", { exact: true }).waitFor();
	const assets = entries.filter(
		(path) => /\.(js|css|woff2)$/.test(path) && path.startsWith("/build/")
	);
	assert(assets.some((path) => path.endsWith(".woff2")));
	for (const asset of assets) {
		const result = await application.evaluate(async ({ net }, path) => {
			const response = await net.fetch(`tuxedo://app${path.slice("/build".length)}`);
			return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
		}, asset);
		assert.equal(result.status, 200, asset);
		assert(result.bytes > 0, asset);
	}
	for (const [url, status] of [
		["tuxedo://other/index.html", 403],
		["tuxedo://app/%2e%2e%2fpackage.json", 403],
		["tuxedo://app/%", 400],
	]) {
		assert.equal(
			await application.evaluate(async ({ net }, url) => (await net.fetch(url)).status, url),
			status,
			url
		);
	}
	assert.equal(
		await application.evaluate(
			async ({ net }) => (await net.fetch("tuxedo://app/", { method: "POST" })).status
		),
		403
	);
	console.log(
		"Packaged executable, bundled assets, SPA navigation/reload, and constrained protocol checks passed."
	);
	// Exercise bundled backend dependencies and native route reloads outside the checkout.
	const todoPath = join(directory, "todo.txt");
	const contents = "Packaged item\r\nLast";
	await application.evaluate(({ dialog }, path) => {
		globalThis.originalSaveDialog = dialog.showSaveDialog;
		dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
	}, todoPath);
	await page.getByRole("button", { name: "New workspace", exact: true }).click();
	const setup = page.getByRole("dialog");
	await setup.getByRole("textbox", { name: "Workspace name" }).fill("Packaged");
	await setup.getByRole("button", { name: "Create a Todo file", exact: true }).click();
	await setup.getByRole("button", { name: "Create workspace", exact: true }).click();
	await setup.waitFor({ state: "detached" });
	await page
		.getByRole("button", { name: "Add your first Todo item", exact: true })
		.and(page.locator(":enabled"))
		.waitFor();
	assert.equal(await readFile(todoPath, "utf8"), "");
	const { active_workspace_id: workspaceId } = JSON.parse(
		await readFile(join(directory, "workspaces.json"), "utf8")
	);
	await page.waitForURL(`tuxedo://app/workspaces/${workspaceId}`);
	await application.evaluate(({ dialog }) => {
		dialog.showSaveDialog = globalThis.originalSaveDialog;
		delete globalThis.originalSaveDialog;
	});
	await application?.close();
	application = undefined;
	await writeFile(todoPath, contents);
	application = await electron.launch({
		executablePath,
		args: [],
		cwd: directory,
		env: {
			...packageEnv,
			TUXEDO_USER_DATA: directory,
			TUXEDO_TEST_HIDDEN: visible ? "0" : "1",
			TUXEDO_RENDERER_ORIGIN: "http://127.0.0.1:1",
		},
		timeout: 20000,
	});
	const restored = await application.firstWindow();
	restored.setDefaultTimeout(10000);
	const checkbox = restored.getByRole("checkbox", {
		name: "Mark Packaged item complete",
		exact: true,
	});
	await checkbox.and(restored.locator(":enabled")).waitFor();
	await restored.waitForURL(`tuxedo://app/workspaces/${workspaceId}`);
	await restored.reload();
	await checkbox.and(restored.locator(":enabled")).waitFor();
	await checkbox.click();
	await restored.getByRole("button", { name: "Undo completion", exact: true }).waitFor();
	assert.match(await readFile(todoPath, "utf8"), /^x \d{4}-\d{2}-\d{2} Packaged item\r\nLast$/);
	await restored.getByRole("button", { name: "Undo completion", exact: true }).click();
	await checkbox.and(restored.locator(":enabled")).waitFor();
	assert.equal(await readFile(todoPath, "utf8"), contents);
	console.log(
		"Packaged persistence, restart, native Workspace reload, completion and Undo passed."
	);
	await panelWorkflow(application, restored, directory);
} finally {
	await application?.close();
	await rm(directory, { recursive: true, force: true });
}
