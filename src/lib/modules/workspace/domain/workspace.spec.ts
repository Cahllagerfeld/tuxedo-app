import { describe, expect, it } from "vitest";
import {
	parseWorkspaceConfigResponse,
	parseWorkspaceLoadResponse,
	workspaceConfigSchema,
	workspaceLoadResultSchema,
	type WorkspaceConfig,
	type WorkspaceLoadResult,
} from "./workspace";

const validWorkspaceConfigResponse: WorkspaceConfig = {
	active_workspace_id: "workspace-1",
	recent_workspaces: [
		{
			id: "workspace-1",
			name: "Work",
			color: "#3b82f6",
			root: "/tmp/todos",
			last_opened_at: "2026-05-30T10:00:00.000Z",
		},
	],
};

const validWorkspaceLoadResponse: WorkspaceLoadResult = {
	root: "/tmp/todos",
	todo_path: "/tmp/todos/todo.txt",
	todo_exists: true,
	todo_file: {
		path: "/tmp/todos/todo.txt",
		items: [
			{
				line_number: 1,
				raw: "(A) Review workspace +Tuxedo",
				completed: false,
				priority: "A",
				creation_date: null,
				completion_date: null,
				description: "Review workspace",
				projects: ["Tuxedo"],
				contexts: [],
				metadata: {},
			},
		],
		skipped: [],
	},
};

describe("workspaceConfigSchema", () => {
	it("accepts recent workspaces and an active workspace id", () => {
		const result = workspaceConfigSchema.safeParse(validWorkspaceConfigResponse);

		expect(result.success).toBe(true);
	});

	it("accepts first-run config without an active workspace", () => {
		const result = workspaceConfigSchema.safeParse({
			active_workspace_id: null,
			recent_workspaces: [],
		});

		expect(result.success).toBe(true);
	});
});

describe("workspaceLoadResultSchema", () => {
	it("accepts a parsed workspace todo file", () => {
		const result = workspaceLoadResultSchema.safeParse(validWorkspaceLoadResponse);

		expect(result.success).toBe(true);
	});

	it("accepts a missing todo.txt result", () => {
		const result = workspaceLoadResultSchema.safeParse({
			root: "/tmp/todos",
			todo_path: "/tmp/todos/todo.txt",
			todo_exists: false,
			todo_file: null,
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

	it("returns validated workspace load responses", () => {
		expect(parseWorkspaceLoadResponse(validWorkspaceLoadResponse)).toEqual(
			validWorkspaceLoadResponse
		);
	});

	it("throws a readable error for config schema drift", () => {
		expect(() =>
			parseWorkspaceConfigResponse({ active_workspace_id: 1, recent_workspaces: [] })
		).toThrow(/Unexpected workspace config response from Rust: active_workspace_id:/);
	});

	it("throws a readable error for load schema drift", () => {
		expect(() =>
			parseWorkspaceLoadResponse({ ...validWorkspaceLoadResponse, todo_exists: "true" })
		).toThrow(/Unexpected workspace load response from Rust: todo_exists:/);
	});
});
