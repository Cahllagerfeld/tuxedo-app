import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { release } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
if (args[0] === "run") args.splice(1, 0, "--cache=local:rw");
const child = spawn(process.execPath, [require.resolve("turbo/bin/turbo"), ...args], {
	cwd: root,
	stdio: "inherit",
	env: {
		...process.env,
		// SvelteKit generates absolute paths; native tooling also depends on the host and Node.
		TUXEDO_TASK_CONTEXT: JSON.stringify([
			root,
			process.platform,
			process.arch,
			release(),
			process.version,
		]),
	},
});
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
	console.error(error);
	process.exitCode = 1;
});
child.on("exit", (code, signal) => {
	process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
