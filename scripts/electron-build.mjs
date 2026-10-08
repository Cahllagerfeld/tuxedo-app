import { build } from "esbuild";
await build({
	entryPoints: ["electron/main.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	external: ["electron"],
	outfile: "dist-electron/main.js",
});
await build({
	entryPoints: ["electron/preload.ts"],
	bundle: true,
	platform: "node",
	format: "cjs",
	external: ["electron"],
	outfile: "dist-electron/preload.cjs",
});
