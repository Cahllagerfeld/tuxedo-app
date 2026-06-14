import type { TodoFile } from "$lib/modules/todo/domain/todo";
import {
	chooseWorkspaceDirectory,
	loadWorkspace,
	loadWorkspaceConfig,
	saveWorkspaceConfig,
	toggleTodoItemCompleted,
} from "$lib/modules/workspace/api/workspace-api";
import type { WorkspaceConfig, WorkspaceLoadResult } from "$lib/modules/workspace/domain/workspace";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceState } from "./workspace-state.svelte";

vi.mock("$lib/modules/workspace/api/workspace-api", () => ({
	chooseWorkspaceDirectory: vi.fn(),
	loadWorkspace: vi.fn(),
	loadWorkspaceConfig: vi.fn(),
	saveWorkspaceConfig: vi.fn(),
	toggleTodoItemCompleted: vi.fn(),
}));

const mockedLoadWorkspaceConfig = vi.mocked(loadWorkspaceConfig);
const mockedLoadWorkspace = vi.mocked(loadWorkspace);
const mockedSaveWorkspaceConfig = vi.mocked(saveWorkspaceConfig);
const mockedChooseWorkspaceDirectory = vi.mocked(chooseWorkspaceDirectory);
const mockedToggleTodoItemCompleted = vi.mocked(toggleTodoItemCompleted);

const todoFile: TodoFile = {
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
};

const savedConfig: WorkspaceConfig = {
	version: 1,
	root: "/tmp/todos",
};

const loadedWorkspace: WorkspaceLoadResult = {
	root: "/tmp/todos",
	todo_path: "/tmp/todos/todo.txt",
	todo_exists: true,
	todo_file: todoFile,
};

describe("WorkspaceState", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockedSaveWorkspaceConfig.mockResolvedValue(savedConfig);
	});

	it("clears loaded workspace state when no workspace is configured", async () => {
		const workspace = new WorkspaceState();
		workspace.root = "/tmp/old";
		workspace.todoPath = "/tmp/old/todo.txt";
		workspace.todoFile = todoFile;
		mockedLoadWorkspaceConfig.mockResolvedValue({ version: 1, root: null });

		await workspace.restore();

		expect(workspace.root).toBeNull();
		expect(workspace.todoPath).toBeNull();
		expect(workspace.todoFile).toBeNull();
		expect(workspace.warning).toBe("");
		expect(workspace.error).toBe("");
		expect(workspace.isLoading).toBe(false);
		expect(mockedLoadWorkspace).not.toHaveBeenCalled();
	});

	it("restores and applies a saved workspace", async () => {
		const workspace = new WorkspaceState();
		workspace.warning = "old warning";
		mockedLoadWorkspaceConfig.mockResolvedValue(savedConfig);
		mockedLoadWorkspace.mockResolvedValue(loadedWorkspace);

		await workspace.restore();

		expect(workspace.root).toBe("/tmp/todos");
		expect(workspace.todoPath).toBe("/tmp/todos/todo.txt");
		expect(workspace.todoFile).toEqual(todoFile);
		expect(workspace.warning).toBe("");
		expect(workspace.error).toBe("");
		expect(mockedLoadWorkspace).toHaveBeenCalledWith("/tmp/todos");
	});

	it("clears stale errors and warnings before restore", async () => {
		const workspace = new WorkspaceState();
		workspace.error = "old error";
		workspace.warning = "old warning";
		mockedLoadWorkspaceConfig.mockResolvedValue(savedConfig);
		mockedLoadWorkspace.mockResolvedValue(loadedWorkspace);

		await workspace.restore();

		expect(workspace.error).toBe("");
		expect(workspace.warning).toBe("");
		expect(workspace.todoFile).toEqual(todoFile);
	});

	it("shows a warning and keeps the workspace usable when todo.txt is missing", async () => {
		const workspace = new WorkspaceState();
		mockedLoadWorkspaceConfig.mockResolvedValue(savedConfig);
		mockedLoadWorkspace.mockResolvedValue({
			root: "/tmp/todos",
			todo_path: "/tmp/todos/todo.txt",
			todo_exists: false,
			todo_file: null,
		});

		await workspace.restore();

		expect(workspace.root).toBe("/tmp/todos");
		expect(workspace.todoPath).toBe("/tmp/todos/todo.txt");
		expect(workspace.todoFile).toBeNull();
		expect(workspace.warning).toBe(
			"No todo.txt file was found in /tmp/todos. Add one there or choose another directory."
		);
		expect(workspace.error).toBe("");
	});

	it("reports restore errors without keeping stale todo file data", async () => {
		const workspace = new WorkspaceState();
		workspace.todoPath = "/tmp/old/todo.txt";
		workspace.todoFile = todoFile;
		mockedLoadWorkspaceConfig.mockResolvedValue(savedConfig);
		mockedLoadWorkspace.mockRejectedValue(
			new Error("workspace directory does not exist: /tmp/todos")
		);

		await workspace.restore();

		expect(workspace.root).toBe("/tmp/todos");
		expect(workspace.todoPath).toBeNull();
		expect(workspace.todoFile).toBeNull();
		expect(workspace.warning).toBe("");
		expect(workspace.error).toBe("workspace directory does not exist: /tmp/todos");
		expect(workspace.isLoading).toBe(false);
	});

	it("leaves the current workspace intact when directory selection is cancelled", async () => {
		const workspace = new WorkspaceState();
		workspace.root = "/tmp/todos";
		workspace.todoPath = "/tmp/todos/todo.txt";
		workspace.todoFile = todoFile;
		mockedChooseWorkspaceDirectory.mockResolvedValue(null);

		await workspace.openDirectory();

		expect(workspace.root).toBe("/tmp/todos");
		expect(workspace.todoPath).toBe("/tmp/todos/todo.txt");
		expect(workspace.todoFile).toEqual(todoFile);
		expect(workspace.error).toBe("");
		expect(workspace.warning).toBe("");
		expect(workspace.isLoading).toBe(false);
		expect(mockedSaveWorkspaceConfig).not.toHaveBeenCalled();
		expect(mockedLoadWorkspace).not.toHaveBeenCalled();
	});

	it("saves and loads a newly selected workspace", async () => {
		const workspace = new WorkspaceState();
		mockedChooseWorkspaceDirectory.mockResolvedValue("/tmp/todos");
		mockedLoadWorkspace.mockResolvedValue(loadedWorkspace);

		await workspace.openDirectory();

		expect(mockedSaveWorkspaceConfig).toHaveBeenCalledWith("/tmp/todos");
		expect(mockedLoadWorkspace).toHaveBeenCalledWith("/tmp/todos");
		expect(workspace.root).toBe("/tmp/todos");
		expect(workspace.todoPath).toBe("/tmp/todos/todo.txt");
		expect(workspace.todoFile).toEqual(todoFile);
		expect(workspace.isLoading).toBe(false);
	});

	it("toggles a todo item and reloads workspace state from disk", async () => {
		const workspace = new WorkspaceState();
		workspace.root = "/tmp/todos";
		workspace.todoPath = "/tmp/todos/todo.txt";
		workspace.todoFile = todoFile;

		const toggledTodoFile: TodoFile = {
			...todoFile,
			items: [
				{
					...todoFile.items[0],
					completed: true,
					completion_date: "2026-06-14",
					raw: "x 2026-06-14 (A) Review workspace +Tuxedo",
				},
			],
		};
		const toggledWorkspace: WorkspaceLoadResult = {
			...loadedWorkspace,
			todo_file: toggledTodoFile,
		};
		mockedToggleTodoItemCompleted.mockResolvedValue(toggledWorkspace);

		await workspace.toggleTodoItemCompleted(1, "(A) Review workspace +Tuxedo");

		expect(mockedToggleTodoItemCompleted).toHaveBeenCalledWith(
			"/tmp/todos",
			1,
			"(A) Review workspace +Tuxedo"
		);
		expect(workspace.todoFile).toEqual(toggledTodoFile);
		expect(workspace.error).toBe("");
	});

	it("reports stale-line toggle errors without applying stale todo file data", async () => {
		const workspace = new WorkspaceState();
		workspace.root = "/tmp/todos";
		workspace.todoPath = "/tmp/todos/todo.txt";
		workspace.todoFile = todoFile;
		mockedToggleTodoItemCompleted.mockRejectedValue(
			new Error(
				'todo line 1 changed on disk; expected "(A) Review workspace +Tuxedo", found "Updated task +Tuxedo"'
			)
		);

		await workspace.toggleTodoItemCompleted(1, "(A) Review workspace +Tuxedo");

		expect(workspace.todoFile).toEqual(todoFile);
		expect(workspace.error).toBe(
			'todo line 1 changed on disk; expected "(A) Review workspace +Tuxedo", found "Updated task +Tuxedo"'
		);
	});

	it("reports an error when toggling without an open workspace", async () => {
		const workspace = new WorkspaceState();

		await workspace.toggleTodoItemCompleted(1, "(A) Review workspace +Tuxedo");

		expect(mockedToggleTodoItemCompleted).not.toHaveBeenCalled();
		expect(workspace.error).toBe("No workspace is open.");
	});
});
