import { describe, expect, it } from "vitest";
import {
	workspaceCatalogueSchema,
	workspaceSessionSnapshotSchema,
	workspaceSessionOperationOutcomeSchema,
	type WorkspaceCatalogue,
	type WorkspaceSessionSnapshot,
} from "./workspace";
import contractFixture from "./workspace-session-contract.fixture.json";

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
	status: "active_workspace_loaded",
	catalogue,
	todo_file: { path: workspace.todo_path, items: [], skipped: [] },
};

describe("workspace response schemas", () => {
	it("accepts every Rust-serialized Workspace session contract fixture", () => {
		expect(contractFixture.snapshots[1]?.todo_file?.items).toHaveLength(1);
		expect(contractFixture.snapshots[1]?.todo_file?.skipped).toHaveLength(1);
		for (const snapshot of contractFixture.snapshots) {
			expect(workspaceSessionSnapshotSchema.safeParse(snapshot).success).toBe(true);
		}
		for (const outcome of contractFixture.outcomes) {
			expect(workspaceSessionOperationOutcomeSchema.safeParse(outcome).success).toBe(true);
		}
	});

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

	it("accepts each tagged Workspace session outcome", () => {
		expect(
			workspaceSessionSnapshotSchema.safeParse({
				status: "no_active_workspace",
				catalogue: { version: 1, active_workspace_id: null, workspaces: [] },
			}).success
		).toBe(true);
		expect(workspaceSessionSnapshotSchema.safeParse(snapshot).success).toBe(true);
		expect(
			workspaceSessionSnapshotSchema.safeParse({
				status: "active_workspace_unavailable",
				catalogue,
				warning: "Todo file does not exist",
			}).success
		).toBe(true);
	});

	it("rejects missing, mismatched, and malformed variant data", () => {
		expect(
			workspaceSessionSnapshotSchema.safeParse({ status: "active_workspace_loaded", catalogue })
				.success
		).toBe(false);
		expect(
			workspaceSessionSnapshotSchema.safeParse({
				status: "no_active_workspace",
				catalogue,
			}).success
		).toBe(false);
		expect(
			workspaceSessionSnapshotSchema.safeParse({
				status: "active_workspace_unavailable",
				catalogue,
				warning: 4,
			}).success
		).toBe(false);
	});

	it("detects contract drift without parsing routine command responses", () => {
		expect(
			workspaceCatalogueSchema.safeParse({
				version: 1,
				active_workspace_id: null,
				workspaces: [{}],
			}).success
		).toBe(false);
		expect(
			workspaceSessionSnapshotSchema.safeParse({
				...snapshot,
				todo_file: { path: "/tmp/other.todo", items: [], skipped: [] },
			}).success
		).toBe(false);
	});
});
