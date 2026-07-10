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

describe("WorkspaceState.create", () => {
	it("applies the newly created active workspace and its Todo file", async () => {
		const createdWorkspace = { ...workspace, id: "550e8400-e29b-41d4-a716-446655440001" };
		const state = new WorkspaceState({
			loadWorkspaceCatalogue: async () => ({
				version: 1,
				active_workspace_id: null,
				workspaces: [],
			}),
			openWorkspace: async () => {
				throw new Error("should not open a workspace");
			},
			createWorkspace: async () => ({
				workspace: createdWorkspace,
				todo_file: { path: createdWorkspace.todo_path, items: [], skipped: [] },
			}),
		});

		await state.create({ name: "Work", color: "blue", todoPath: "/tmp/work.todo" });

		expect(state.activeWorkspace).toEqual(createdWorkspace);
		expect(state.todoFile?.path).toBe(createdWorkspace.todo_path);
		expect(state.catalogue?.active_workspace_id).toBe(createdWorkspace.id);
	});

	it("keeps the current catalogue and Todo file when creation fails", async () => {
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
			createWorkspace: async () => {
				throw new Error("duplicate workspace name: Work");
			},
		});
		await state.restore();

		await expect(
			state.create({ name: "Work", color: "blue", todoPath: "/tmp/other.todo" })
		).rejects.toThrow(/duplicate workspace name/);

		expect(state.activeWorkspace).toEqual(workspace);
		expect(state.todoFile?.path).toBe(workspace.todo_path);
	});
});

describe("WorkspaceState.open", () => {
	const personalWorkspace = {
		...workspace,
		id: "550e8400-e29b-41d4-a716-446655440002",
		name: "Personal",
		color: "green" as const,
		todo_path: "/tmp/personal.todo",
	};

	it("applies and persists a selected workspace after its Todo file loads", async () => {
		const state = new WorkspaceState({
			openWorkspace: async (id) => {
				expect(id).toBe(personalWorkspace.id);
				return {
					workspace: personalWorkspace,
					todo_file: { path: personalWorkspace.todo_path, items: [], skipped: [] },
				};
			},
		});
		state.catalogue = {
			version: 1,
			active_workspace_id: workspace.id,
			workspaces: [workspace, personalWorkspace],
		};
		state.activeWorkspace = workspace;
		state.todoFile = { path: workspace.todo_path, items: [], skipped: [] };

		await state.open(personalWorkspace.id);

		expect(state.activeWorkspace).toEqual(personalWorkspace);
		expect(state.todoFile?.path).toBe(personalWorkspace.todo_path);
		expect(state.catalogue?.active_workspace_id).toBe(personalWorkspace.id);
	});

	it("keeps the current workspace and Todo data when a selected workspace cannot load", async () => {
		const state = new WorkspaceState({
			openWorkspace: async () => {
				throw new Error("todo file does not exist");
			},
		});
		state.catalogue = {
			version: 1,
			active_workspace_id: workspace.id,
			workspaces: [workspace, personalWorkspace],
		};
		state.activeWorkspace = workspace;
		state.todoFile = { path: workspace.todo_path, items: [], skipped: [] };

		await state.open(personalWorkspace.id);

		expect(state.activeWorkspace).toEqual(workspace);
		expect(state.todoFile?.path).toBe(workspace.todo_path);
		expect(state.catalogue?.active_workspace_id).toBe(workspace.id);
		expect(state.error).toMatch(/todo file does not exist/);
	});
});

describe("WorkspaceState.delete", () => {
	it("removes the active workspace and its loaded Todo data after deletion persists", async () => {
		const remainingWorkspace = {
			...workspace,
			id: "550e8400-e29b-41d4-a716-446655440003",
			name: "Personal",
			todo_path: "/tmp/personal.todo",
		};
		const state = new WorkspaceState({
			deleteWorkspace: async (id) => {
				expect(id).toBe(workspace.id);
				return { version: 1, active_workspace_id: null, workspaces: [remainingWorkspace] };
			},
		});
		state.catalogue = {
			version: 1,
			active_workspace_id: workspace.id,
			workspaces: [workspace, remainingWorkspace],
		};
		state.activeWorkspace = workspace;
		state.todoFile = { path: workspace.todo_path, items: [], skipped: [] };

		await state.delete(workspace.id);

		expect(state.catalogue).toEqual({
			version: 1,
			active_workspace_id: null,
			workspaces: [remainingWorkspace],
		});
		expect(state.activeWorkspace).toBeNull();
		expect(state.todoFile).toBeNull();
	});

	it("keeps the active workspace and Todo data when deletion cannot persist", async () => {
		const state = new WorkspaceState({
			deleteWorkspace: async () => {
				throw new Error("catalogue is unavailable");
			},
		});
		state.catalogue = { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] };
		state.activeWorkspace = workspace;
		state.todoFile = { path: workspace.todo_path, items: [], skipped: [] };

		await state.delete(workspace.id);

		expect(state.catalogue?.active_workspace_id).toBe(workspace.id);
		expect(state.activeWorkspace).toEqual(workspace);
		expect(state.todoFile?.path).toBe(workspace.todo_path);
		expect(state.error).toMatch(/catalogue is unavailable/);
	});
});
