import { defineConfig } from "vitest/config";
export default defineConfig({
	test: {
		environment: "node",
		include: ["electron/backend/**/*.spec.ts", "src/lib/shared/desktop/**/*.spec.ts"],
	},
});
