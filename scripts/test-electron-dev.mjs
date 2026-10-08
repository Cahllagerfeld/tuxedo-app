import { spawn } from "node:child_process";
const vite = spawn(
	process.execPath,
	["node_modules/vite/bin/vite.js", "--mode", "electron", "--host", "127.0.0.1"],
	{
		stdio: "ignore",
		env: { ...process.env, ELECTRON_STARTUP_PREVENT: "1" },
	}
);
try {
	const origin = "http://127.0.0.1:1420";
	for (let attempt = 0; attempt < 100; attempt++) {
		if (vite.exitCode !== null) throw Error("Renderer server exited");
		try {
			if ((await fetch(origin)).ok) break;
		} catch {}
		if (attempt === 99) throw Error("Renderer startup timed out");
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	process.env.TUXEDO_RENDERER_ORIGIN = origin;
	await import("./test-electron.mjs");
} finally {
	vite.kill();
}
