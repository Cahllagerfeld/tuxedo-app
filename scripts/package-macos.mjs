import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

if (process.platform !== "darwin") throw Error("Local packaging currently requires macOS");
const stage = await mkdtemp(join(tmpdir(), "tuxedo-package-"));
try {
	const source = JSON.parse(await readFile("package.json", "utf8"));
	await Promise.all([
		cp("build", join(stage, "build"), { recursive: true }),
		cp("dist-electron", join(stage, "dist-electron"), { recursive: true }),
		mkdir(join(stage, "node_modules")),
	]);
	await writeFile(
		join(stage, "package.json"),
		JSON.stringify(
			{
				name: source.name,
				productName: "Tuxedo",
				version: source.version,
				description: "Todo-file Workspaces",
				author: "Tuxedo contributors",
				license: source.license,
				type: "module",
				main: source.main,
				devDependencies: {
					electron: JSON.parse(await readFile("node_modules/electron/package.json", "utf8"))
						.version,
				},
				config: {
					forge: {
						packagerConfig: {
							name: "Tuxedo",
							executableName: "Tuxedo",
							appBundleId: "dev.tuxedo.electron",
							asar: true,
							icon: resolve("assets/icon.icns"),
							prune: false,
							electronVersion: JSON.parse(
								await readFile("node_modules/electron/package.json", "utf8")
							).version,
						},
						makers: [],
					},
				},
			},
			null,
			2
		)
	);
	const require = createRequire(import.meta.url);
	const cli = join(
		require.resolve("@electron-forge/cli/package.json"),
		"../dist/electron-forge.js"
	);
	// Forge packages a dependency-free staging directory, not pnpm symlinked node_modules.
	const packageEnv = { ...process.env };
	delete packageEnv.npm_config_user_agent;
	delete packageEnv.npm_execpath;
	const result = spawnSync(
		process.execPath,
		[cli, "package", stage, "--platform=darwin", `--arch=${process.arch}`],
		{ stdio: "inherit", cwd: stage, env: packageEnv }
	);
	if (result.status !== 0) throw Error("Forge packaging failed");
	await rm(resolve("out"), { recursive: true, force: true });
	await cp(join(stage, "out"), resolve("out"), { recursive: true, verbatimSymlinks: true });
} finally {
	await rm(stage, { recursive: true, force: true });
}
