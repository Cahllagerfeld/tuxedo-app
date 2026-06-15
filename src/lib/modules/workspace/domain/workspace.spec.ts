import { describe, expect, it } from "vitest";
import {
	parseWorkspaceConfigResponse,
	parseWorkspaceTodoResolutionResponse,
	workspaceConfigSchema,
	workspaceTodoResolutionSchema,
	type WorkspaceConfig,
	type WorkspaceTodoResolution,
} from "./workspace";

const validWorkspaceConfigResponse: WorkspaceConfig = {
	version: 1,
	root: "/tmp/todos",
};

const validWorkspaceTodoResolutionResponse: WorkspaceTodoResolution = {
	root: "/tmp/todos",
	todo_path: "/tmp/todos/todo.txt",
	todo_exists: true,
};

describe("workspaceConfigSchema", () => {
	it("accepts a saved workspace root", () => {
		const result = workspaceConfigSchema.safeParse(validWorkspaceConfigResponse);

		expect(result.success).toBe(true);
	});

	it("accepts first-run config without a root", () => {
		const result = workspaceConfigSchema.safeParse({ version: 1, root: null });

		expect(result.success).toBe(true);
	});
});

describe("workspaceTodoResolutionSchema", () => {
	it("accepts a resolved workspace todo path", () => {
		const result = workspaceTodoResolutionSchema.safeParse(validWorkspaceTodoResolutionResponse);

		expect(result.success).toBe(true);
	});

	it("accepts a missing todo.txt result", () => {
		const result = workspaceTodoResolutionSchema.safeParse({
			root: "/tmp/todos",
			todo_path: "/tmp/todos/todo.txt",
			todo_exists: false,
		});

		expect(result.success).toBe(true);
	});
});

describe("workspace response parsers", () => {
	it("returns validated workspace config responses", () => {
		expect(parseWorkspaceConfigResponse(validWorkspaceConfigResponse)).toEqual(
			validWorkspaceConfigResponse
		);
	});

	it("returns validated workspace todo resolution responses", () => {
		expect(parseWorkspaceTodoResolutionResponse(validWorkspaceTodoResolutionResponse)).toEqual(
			validWorkspaceTodoResolutionResponse
		);
	});

	it("throws a readable error for config schema drift", () => {
		expect(() => parseWorkspaceConfigResponse({ version: "1", root: null })).toThrow(
			/Unexpected workspace config response from Rust: version:/
		);
	});

	it("throws a readable error for resolution schema drift", () => {
		expect(() =>
			parseWorkspaceTodoResolutionResponse({
				...validWorkspaceTodoResolutionResponse,
				todo_exists: "true",
			})
		).toThrow(/Unexpected workspace todo resolution response from Rust: todo_exists:/);
	});
});
