import { spawn } from "node:child_process";
import electronPath from "electron";
import "./electron-build.mjs";
const origin = "http://127.0.0.1:1420";
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"], {
	stdio: "inherit",
});
let electron;
const cleanup = () => {
	electron?.kill();
	vite.kill();
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);
for (let attempt = 0; attempt < 100; attempt++) {
	if (vite.exitCode !== null) throw Error("Renderer server exited");
	try {
		const response = await fetch(origin);
		if (response.ok) break;
	} catch {}
	if (attempt === 99) throw Error("Renderer server failed to start");
	await new Promise((resolve) => setTimeout(resolve, 200));
}
electron = spawn(electronPath, ["dist-electron/main.js"], {
	stdio: "inherit",
	env: { ...process.env, TUXEDO_RENDERER_ORIGIN: origin },
});
electron.on("exit", (code) => {
	cleanup();
	process.exit(code ?? 1);
});
