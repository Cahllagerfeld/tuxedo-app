import { describe, expect, it } from "vitest";
import { WorkspaceState } from "./workspace-state.svelte";

const workspace = {
	id: "550e8400-e29b-41d4-a716-446655440000",
	name: "Work",
	color: "blue" as const,
	todo_path: "/tmp/work.todo",
	created_at: "2026-07-10T10:00:00+00:00",
};

describe("WorkspaceState.restore", () => {
	it("enters Empty state on first run", async () => {
		const state = new WorkspaceState({
			loadWorkspaceCatalogue: async () => ({
				version: 1,
				active_workspace_id: null,
				workspaces: [],
			}),
			openWorkspace: async () => {
				throw new Error("should not open a workspace");
			},
		});

		await state.restore();

		expect(state.activeWorkspace).toBeNull();
		expect(state.todoFile).toBeNull();
		expect(state.error).toBe("");
	});

	it("loads the saved active workspace", async () => {
		const state = new WorkspaceState({
			loadWorkspaceCatalogue: async () => ({
				version: 1,
				active_workspace_id: workspace.id,
				workspaces: [workspace],
			}),
			openWorkspace: async () => ({
				workspace,
				todo_file: { path: workspace.todo_path, items: [], skipped: [] },
			}),
		});

		await state.restore();

		expect(state.activeWorkspace).toEqual(workspace);
		expect(state.todoFile?.path).toBe(workspace.todo_path);
	});

	it("clears loaded task data when a saved workspace cannot open", async () => {
		const state = new WorkspaceState({
			loadWorkspaceCatalogue: async () => ({
				version: 1,
				active_workspace_id: workspace.id,
				workspaces: [workspace],
			}),
			openWorkspace: async () => {
				throw new Error("todo file does not exist");
			},
		});
		state.todoFile = { path: "/tmp/stale.todo", items: [], skipped: [] };

		await state.restore();

		expect(state.activeWorkspace).toBeNull();
		expect(state.todoFile).toBeNull();
		expect(state.warning).toMatch(/todo file does not exist/);
	});

	it("keeps a malformed catalogue non-destructive and reports its error", async () => {
		const state = new WorkspaceState({
			loadWorkspaceCatalogue: async () => {
				throw new Error("failed to parse workspace catalogue");
			},
			openWorkspace: async () => {
				throw new Error("should not open a workspace");
			},
		});

		await state.restore();

		expect(state.activeWorkspace).toBeNull();
		expect(state.todoFile).toBeNull();
		expect(state.error).toMatch(/failed to parse workspace catalogue/);
	});
});
