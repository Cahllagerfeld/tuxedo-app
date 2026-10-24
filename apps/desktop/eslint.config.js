import js from "@eslint/js";
import { loadConfig } from "@sveltejs/load-config";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import ts from "typescript-eslint";

const svelteConfig = (await loadConfig("./", { traverse: false }))?.config;

export default defineConfig({
	files: ["src/**/*.svelte"],
	extends: [
		js.configs.recommended,
		ts.configs.recommended,
		svelte.configs.recommended,
		svelte.configs.prettier,
		prettier,
	],
	languageOptions: {
		globals: globals.browser,
		parserOptions: {
			parser: ts.parser,
			svelteConfig,
		},
	},
});
