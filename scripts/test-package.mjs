import { _electron as electron } from "playwright";
import { listPackage } from "@electron/asar";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const bundle = resolve(`out/Tuxedo-darwin-${process.arch}/Tuxedo.app`);
const executablePath = join(bundle, "Contents/MacOS/Tuxedo");
const entries = listPackage(join(bundle, "Contents/Resources/app.asar"));
assert(entries.includes("/build/index.html"));
assert(entries.includes("/dist-electron/main.js"));
assert(entries.includes("/dist-electron/preload.cjs"));
assert(
	entries.every((path) => /^\/(build|dist-electron|package\.json|node_modules)(\/|$)/.test(path))
);
const directory = await mkdtemp(join(tmpdir(), "tuxedo-packaged-"));
let application;
try {
	application = await electron.launch({
		executablePath,
		args: [],
		cwd: directory,
		env: {
			...process.env,
			TUXEDO_USER_DATA: directory,
			TUXEDO_RENDERER_ORIGIN: "http://127.0.0.1:1",
		},
		timeout: 20000,
	});
	const page = await application.firstWindow();
	page.setDefaultTimeout(10000);
	console.log("Packaged initial URL:", page.url());
	await page.getByText("No workspace open", { exact: true }).waitFor();
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
} finally {
	await application?.close();
	await rm(directory, { recursive: true, force: true });
}

for (const script of ["scripts/test-electron.mjs", "scripts/test-electron-deletion.mjs"]) {
	const result = spawnSync(process.execPath, [script], {
		stdio: "inherit",
		env: {
			...process.env,
			TUXEDO_PACKAGED_EXECUTABLE: executablePath,
			TUXEDO_RENDERER_ORIGIN: "http://127.0.0.1:1",
		},
	});
	assert.equal(result.status, 0, script);
}
