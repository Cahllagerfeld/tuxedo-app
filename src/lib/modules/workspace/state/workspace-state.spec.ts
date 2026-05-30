import type { TodoFile } from "$lib/modules/todo/domain/todo";
import type {
	WorkspaceConfig,
	WorkspaceEntry,
	WorkspaceLoadResult,
} from "$lib/modules/workspace/domain/workspace";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceState } from "./workspace-state.svelte";

const api = vi.hoisted(() => ({
	chooseWorkspaceDirectory: vi.fn(),
	loadWorkspace: vi.fn(),
	loadWorkspaceConfig: vi.fn(),
	saveWorkspaceEntry: vi.fn(),
	setActiveWorkspace: vi.fn(),
}));

vi.mock("$lib/modules/workspace/api/workspace-api", () => api);

const work: WorkspaceEntry = {
	id: "workspace-work",
	name: "Work",
	color: "#3b82f6",
	root: "/tmp/work",
	last_opened_at: "2026-05-30T10:00:00.000Z",
};

const personal: WorkspaceEntry = {
	id: "workspace-personal",
	name: "Personal",
	color: "#10b981",
	root: "/tmp/personal",
	last_opened_at: "2026-05-30T11:00:00.000Z",
};

const todoFile: TodoFile = {
	path: "/tmp/work/todo.txt",
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
};

function config(
	activeWorkspaceId: string | null,
	recentWorkspaces: WorkspaceEntry[]
): WorkspaceConfig {
	return {
		active_workspace_id: activeWorkspaceId,
		recent_workspaces: recentWorkspaces,
	};
}

function loadResult(
	workspace: WorkspaceEntry,
	overrides: Partial<WorkspaceLoadResult> = {}
): WorkspaceLoadResult {
	return {
		root: workspace.root,
		todo_path: `${workspace.root}/todo.txt`,
		todo_exists: true,
		todo_file: todoFile,
		...overrides,
	};
}

describe("WorkspaceState", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("restores empty config without an active workspace", async () => {
		api.loadWorkspaceConfig.mockResolvedValue(config(null, []));
		const workspace = new WorkspaceState();

		await workspace.restore();

		expect(workspace.activeWorkspace).toBeNull();
		expect(workspace.recentWorkspaces).toEqual([]);
		expect(workspace.todoFile).toBeNull();
		expect(workspace.isLoading).toBe(false);
		expect(api.loadWorkspace).not.toHaveBeenCalled();
	});

	it("restores the active workspace and loads its todo file", async () => {
		api.loadWorkspaceConfig.mockResolvedValue(config(work.id, [work]));
		api.loadWorkspace.mockResolvedValue(loadResult(work));
		const workspace = new WorkspaceState();

		await workspace.restore();

		expect(workspace.activeWorkspace).toEqual(work);
		expect(workspace.recentWorkspaces).toEqual([work]);
		expect(workspace.root).toBe(work.root);
		expect(workspace.todoPath).toBe("/tmp/work/todo.txt");
		expect(workspace.todoFile).toEqual(todoFile);
		expect(workspace.warning).toBe("");
	});

	it("falls back to the first recent workspace when the active id is missing", async () => {
		api.loadWorkspaceConfig.mockResolvedValue(config("missing", [work]));
		api.loadWorkspace.mockResolvedValue(loadResult(work));
		const workspace = new WorkspaceState();

		await workspace.restore();

		expect(workspace.activeWorkspace).toEqual(work);
		expect(api.loadWorkspace).toHaveBeenCalledWith(work.root);
	});

	it("preserves existing workspace data when directory picking is canceled", async () => {
		api.chooseWorkspaceDirectory.mockResolvedValue(null);
		const workspace = new WorkspaceState();
		workspace.activeWorkspace = work;
		workspace.recentWorkspaces = [work];
		workspace.todoPath = "/tmp/work/todo.txt";
		workspace.todoFile = todoFile;
		workspace.warning = "Existing warning";
		workspace.error = "Existing error";

		await workspace.openDirectory();

		expect(workspace.activeWorkspace).toEqual(work);
		expect(workspace.recentWorkspaces).toEqual([work]);
		expect(workspace.todoPath).toBe("/tmp/work/todo.txt");
		expect(workspace.todoFile).toEqual(todoFile);
		expect(workspace.warning).toBe("Existing warning");
		expect(workspace.error).toBe("Existing error");
		expect(workspace.isLoading).toBe(false);
		expect(api.saveWorkspaceEntry).not.toHaveBeenCalled();
	});

	it("opens a chosen directory, applies config, and loads the active workspace", async () => {
		api.chooseWorkspaceDirectory.mockResolvedValue(personal.root);
		api.saveWorkspaceEntry.mockResolvedValue(config(personal.id, [personal, work]));
		api.loadWorkspace.mockResolvedValue(loadResult(personal, { todo_file: null }));
		const workspace = new WorkspaceState();

		await workspace.openDirectory();

		expect(api.saveWorkspaceEntry).toHaveBeenCalledWith(personal.root);
		expect(api.loadWorkspace).toHaveBeenCalledWith(personal.root);
		expect(workspace.activeWorkspace).toEqual(personal);
		expect(workspace.recentWorkspaces).toEqual([personal, work]);
		expect(workspace.todoPath).toBe("/tmp/personal/todo.txt");
	});

	it("switches to an existing workspace and loads it", async () => {
		api.setActiveWorkspace.mockResolvedValue(config(personal.id, [personal, work]));
		api.loadWorkspace.mockResolvedValue(loadResult(personal));
		const workspace = new WorkspaceState();

		await workspace.switchWorkspace(personal.id);

		expect(api.setActiveWorkspace).toHaveBeenCalledWith(personal.id);
		expect(api.loadWorkspace).toHaveBeenCalledWith(personal.root);
		expect(workspace.activeWorkspace).toEqual(personal);
		expect(workspace.todoFile).toEqual(todoFile);
	});

	it("sets a warning when the active workspace has no todo.txt", async () => {
		api.loadWorkspaceConfig.mockResolvedValue(config(work.id, [work]));
		api.loadWorkspace.mockResolvedValue(
			loadResult(work, {
				todo_exists: false,
				todo_file: null,
			})
		);
		const workspace = new WorkspaceState();

		await workspace.restore();

		expect(workspace.todoPath).toBe("/tmp/work/todo.txt");
		expect(workspace.todoFile).toBeNull();
		expect(workspace.warning).toContain("No todo.txt file was found");
	});
});
