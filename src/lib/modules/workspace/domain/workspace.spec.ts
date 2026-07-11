import { describe, expect, it } from "vitest";
import {
	parseWorkspaceCatalogueResponse,
	parseWorkspaceSessionSnapshotResponse,
	workspaceCatalogueSchema,
	workspaceSessionSnapshotSchema,
	type WorkspaceCatalogue,
	type WorkspaceSessionSnapshot,
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

const snapshot: WorkspaceSessionSnapshot = {
	catalogue,
	todo_file: { path: workspace.todo_path, items: [], skipped: [] },
	warning: null,
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
		expect(workspaceSessionSnapshotSchema.safeParse(snapshot).success).toBe(true);
	});

	it("returns validated Rust responses", () => {
		expect(parseWorkspaceCatalogueResponse(catalogue)).toEqual(catalogue);
		expect(parseWorkspaceSessionSnapshotResponse(snapshot)).toEqual(snapshot);
	});

	it("reports schema drift clearly", () => {
		expect(() =>
			parseWorkspaceCatalogueResponse({ version: 1, active_workspace_id: null, workspaces: [{}] })
		).toThrow(/Unexpected workspace catalogue response from Rust: workspaces.0.id:/);
		expect(() =>
			parseWorkspaceSessionSnapshotResponse({
				...snapshot,
				todo_file: { path: "/tmp/other.todo", items: [], skipped: [] },
			})
		).toThrow(
			/Unexpected workspace session snapshot response from Rust: response: Todo file must belong to the active workspace/
		);
	});
});
