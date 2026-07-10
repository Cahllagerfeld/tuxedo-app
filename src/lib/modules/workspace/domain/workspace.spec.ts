import { describe, expect, it } from "vitest";
import {
	parseWorkspaceCatalogueResponse,
	parseWorkspaceLoadResponse,
	workspaceCatalogueSchema,
	workspaceLoadResultSchema,
	type WorkspaceCatalogue,
	type WorkspaceLoadResult,
} from "./workspace";

const workspace = {
	id: "550e8400-e29b-41d4-a716-446655440000",
	name: "Work",
	color: "blue",
	todo_path: "/tmp/work.todo",
	created_at: "2026-07-10T10:00:00+00:00",
} as const;

const catalogue: WorkspaceCatalogue = {
	version: 1,
	active_workspace_id: workspace.id,
	workspaces: [workspace],
};

const loadResult: WorkspaceLoadResult = {
	workspace,
	todo_file: { path: workspace.todo_path, items: [], skipped: [] },
};

describe("workspace response schemas", () => {
	it("accepts the first-run empty catalogue", () => {
		expect(
			workspaceCatalogueSchema.safeParse({ version: 1, active_workspace_id: null, workspaces: [] })
				.success
		).toBe(true);
	});

	it("accepts a catalogue and loaded exact Todo file", () => {
		expect(workspaceCatalogueSchema.safeParse(catalogue).success).toBe(true);
		expect(workspaceLoadResultSchema.safeParse(loadResult).success).toBe(true);
	});

	it("returns validated Rust responses", () => {
		expect(parseWorkspaceCatalogueResponse(catalogue)).toEqual(catalogue);
		expect(parseWorkspaceLoadResponse(loadResult)).toEqual(loadResult);
	});

	it("reports schema drift clearly", () => {
		expect(() =>
			parseWorkspaceCatalogueResponse({ version: 1, active_workspace_id: null, workspaces: [{}] })
		).toThrow(/Unexpected workspace catalogue response from Rust: workspaces.0.id:/);
		expect(() => parseWorkspaceLoadResponse({ ...loadResult, todo_file: null })).toThrow(
			/Unexpected workspace load response from Rust: todo_file:/
		);
	});
});
