import { defineConfig } from "vitest/config";
export default defineConfig({
	test: {
		environment: "node",
		include: ["electron/**/*.spec.ts", "src/lib/shared/todo-creation.spec.ts"],
	},
});
