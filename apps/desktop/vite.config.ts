import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";
import type { ElectronOptions } from "vite-plugin-electron";

let desktopStarted = false;
const startDesktop: NonNullable<ElectronOptions["onstart"]> = async ({ startup }) => {
	// The plugin's convenience environment flags must not weaken desktop isolation.
	delete process.env.ELECTRON_DISABLE_WEB_SECURITY;
	delete process.env.ELECTRON_IGNORE_CERTIFICATE_ERRORS;
	desktopStarted = await startup(["."], {
		env: { ...process.env, TUXEDO_RENDERER_ORIGIN: "http://127.0.0.1:1420" },
	});
};

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => ({
	plugins: [
		...(mode === "electron" && !process.env.VITEST
			? await electron({
					main: {
						entry: "electron/main.ts",
						onstart: startDesktop,
					},
					preload: {
						input: "electron/preload.ts",
						onstart: async (context) => {
							if (desktopStarted) context.reload();
							else await startDesktop(context);
						},
						vite: {
							build: {
								rolldownOptions: {
									output: { entryFileNames: "preload.cjs", codeSplitting: false },
								},
							},
						},
					},
				})
			: []),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
			},
			preprocess: vitePreprocess(),

			// Desktop updates do not deploy through the renderer's custom protocol.
			version: { pollInterval: 0 },
			adapter: adapter({
				fallback: "index.html",
			}),
		}),
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: "./vite.config.ts",
				test: {
					name: "client",
					api: { port: Number(process.env.TUXEDO_TEST_PORT ?? 63315) },
					browser: {
						enabled: true,
						// Motion-specific tests explicitly exercise both preferences.
						provider: playwright({ contextOptions: { reducedMotion: "reduce" } }),
						instances: [{ browser: "chromium", headless: true }],
					},
					include: ["src/**/*.svelte.{test,spec}.{js,ts}"],
					exclude: ["src/lib/server/**"],
				},
			},

			{
				extends: "./vite.config.ts",
				test: {
					name: "server",
					environment: "node",
					include: ["src/**/*.{test,spec}.{js,ts}"],
					exclude: ["src/**/*.svelte.{test,spec}.{js,ts}"],
				},
			},
		],
	},

	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		host: "127.0.0.1",
		watch: { ignored: ["**/examples/**", "**/.repos/**"] },
	},
}));
