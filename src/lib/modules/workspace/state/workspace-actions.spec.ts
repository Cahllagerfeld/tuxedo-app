import type { TodoFile } from "$lib/modules/todo/domain/todo";
import { parseTodoFile } from "$lib/modules/todo/api/todo-api";
import {
	chooseWorkspaceDirectory,
	loadWorkspaceConfig,
	resolveWorkspaceTodo,
	saveWorkspaceConfig,
} from "$lib/modules/workspace/api/workspace-api";
import type { WorkspaceConfig, WorkspaceTodoResolution } from "$lib/modules/workspace/domain/workspace";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	loadWorkspaceRoot,
	openWorkspaceDirectory,
	restoreWorkspace,
	toggleTodoItem,
} from "./workspace-actions";
import { WorkspaceStore } from "./workspace-store.svelte";

vi.mock("$lib/modules/workspace/api/workspace-api", () => ({
	chooseWorkspaceDirectory: vi.fn(),
	loadWorkspaceConfig: vi.fn(),
	resolveWorkspaceTodo: vi.fn(),
	saveWorkspaceConfig: vi.fn(),
}));

vi.mock("$lib/modules/todo/api/todo-api", () => ({
	parseTodoFile: vi.fn(),
	toggleTodoItemCompleted: vi.fn(),
}));

import { toggleTodoItemCompleted } from "$lib/modules/todo/api/todo-api";

const mockedLoadWorkspaceConfig = vi.mocked(loadWorkspaceConfig);
const mockedResolveWorkspaceTodo = vi.mocked(resolveWorkspaceTodo);
const mockedParseTodoFile = vi.mocked(parseTodoFile);
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

const resolvedWorkspace: WorkspaceTodoResolution = {
	root: "/tmp/todos",
	todo_path: "/tmp/todos/todo.txt",
	todo_exists: true,
};

describe("workspace actions", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockedSaveWorkspaceConfig.mockResolvedValue(savedConfig);
	});

	it("clears loaded workspace state when no workspace is configured", async () => {
		const store = new WorkspaceStore();
		store.root = "/tmp/old";
		store.todoPath = "/tmp/old/todo.txt";
		store.todoFile = todoFile;
		mockedLoadWorkspaceConfig.mockResolvedValue({ version: 1, root: null });

		await restoreWorkspace(store);

		expect(store.root).toBeNull();
		expect(store.todoPath).toBeNull();
		expect(store.todoFile).toBeNull();
		expect(store.warning).toBe("");
		expect(store.error).toBe("");
		expect(store.isLoading).toBe(false);
		expect(mockedResolveWorkspaceTodo).not.toHaveBeenCalled();
	});

	it("restores and applies a saved workspace", async () => {
		const store = new WorkspaceStore();
		store.warning = "old warning";
		mockedLoadWorkspaceConfig.mockResolvedValue(savedConfig);
		mockedResolveWorkspaceTodo.mockResolvedValue(resolvedWorkspace);
		mockedParseTodoFile.mockResolvedValue(todoFile);

		await restoreWorkspace(store);

		expect(store.root).toBe("/tmp/todos");
		expect(store.todoPath).toBe("/tmp/todos/todo.txt");
		expect(store.todoExists).toBe(true);
		expect(store.todoFile).toEqual(todoFile);
		expect(store.warning).toBe("");
		expect(store.error).toBe("");
		expect(mockedResolveWorkspaceTodo).toHaveBeenCalledWith("/tmp/todos");
		expect(mockedParseTodoFile).toHaveBeenCalledWith("/tmp/todos/todo.txt");
	});

	it("clears stale errors and warnings before restore", async () => {
		const store = new WorkspaceStore();
		store.error = "old error";
		store.warning = "old warning";
		mockedLoadWorkspaceConfig.mockResolvedValue(savedConfig);
		mockedResolveWorkspaceTodo.mockResolvedValue(resolvedWorkspace);
		mockedParseTodoFile.mockResolvedValue(todoFile);

		await restoreWorkspace(store);

		expect(store.error).toBe("");
		expect(store.warning).toBe("");
		expect(store.todoFile).toEqual(todoFile);
	});

	it("shows a warning and keeps the workspace usable when todo.txt is missing", async () => {
		const store = new WorkspaceStore();
		mockedLoadWorkspaceConfig.mockResolvedValue(savedConfig);
		mockedResolveWorkspaceTodo.mockResolvedValue({
			root: "/tmp/todos",
			todo_path: "/tmp/todos/todo.txt",
			todo_exists: false,
		});

		await restoreWorkspace(store);

		expect(store.root).toBe("/tmp/todos");
		expect(store.todoPath).toBe("/tmp/todos/todo.txt");
		expect(store.todoExists).toBe(false);
		expect(store.todoFile).toBeNull();
		expect(store.warning).toBe(
			"No todo.txt file was found in /tmp/todos. Add one there or choose another directory."
		);
		expect(store.error).toBe("");
		expect(mockedParseTodoFile).not.toHaveBeenCalled();
	});

	it("reports restore errors without keeping stale todo file data", async () => {
		const store = new WorkspaceStore();
		store.todoPath = "/tmp/old/todo.txt";
		store.todoFile = todoFile;
		mockedLoadWorkspaceConfig.mockResolvedValue(savedConfig);
		mockedResolveWorkspaceTodo.mockRejectedValue(
			new Error("workspace directory does not exist: /tmp/todos")
		);

		await restoreWorkspace(store);

		expect(store.root).toBe("/tmp/todos");
		expect(store.todoPath).toBeNull();
		expect(store.todoFile).toBeNull();
		expect(store.warning).toBe("");
		expect(store.error).toBe("workspace directory does not exist: /tmp/todos");
		expect(store.isLoading).toBe(false);
	});

	it("leaves the current workspace intact when directory selection is cancelled", async () => {
		const store = new WorkspaceStore();
		store.root = "/tmp/todos";
		store.todoPath = "/tmp/todos/todo.txt";
		store.todoFile = todoFile;
		mockedChooseWorkspaceDirectory.mockResolvedValue(null);

		await openWorkspaceDirectory(store);

		expect(store.root).toBe("/tmp/todos");
		expect(store.todoPath).toBe("/tmp/todos/todo.txt");
		expect(store.todoFile).toEqual(todoFile);
		expect(store.error).toBe("");
		expect(store.warning).toBe("");
		expect(store.isLoading).toBe(false);
		expect(mockedSaveWorkspaceConfig).not.toHaveBeenCalled();
		expect(mockedResolveWorkspaceTodo).not.toHaveBeenCalled();
	});

	it("saves and loads a newly selected workspace", async () => {
		const store = new WorkspaceStore();
		mockedChooseWorkspaceDirectory.mockResolvedValue("/tmp/todos");
		mockedResolveWorkspaceTodo.mockResolvedValue(resolvedWorkspace);
		mockedParseTodoFile.mockResolvedValue(todoFile);

		await openWorkspaceDirectory(store);

		expect(mockedSaveWorkspaceConfig).toHaveBeenCalledWith("/tmp/todos");
		expect(mockedResolveWorkspaceTodo).toHaveBeenCalledWith("/tmp/todos");
		expect(store.root).toBe("/tmp/todos");
		expect(store.todoPath).toBe("/tmp/todos/todo.txt");
		expect(store.todoFile).toEqual(todoFile);
		expect(store.isLoading).toBe(false);
	});

	it("loads workspace root by resolving and parsing separately", async () => {
		const store = new WorkspaceStore();
		mockedResolveWorkspaceTodo.mockResolvedValue(resolvedWorkspace);
		mockedParseTodoFile.mockResolvedValue(todoFile);

		await loadWorkspaceRoot(store, "/tmp/todos");

		expect(store.root).toBe("/tmp/todos");
		expect(store.todoPath).toBe("/tmp/todos/todo.txt");
		expect(store.todoExists).toBe(true);
		expect(store.todoFile).toEqual(todoFile);
	});

	it("toggles a todo item and updates todo file from the mutation response", async () => {
		const store = new WorkspaceStore();
		store.root = "/tmp/todos";
		store.todoPath = "/tmp/todos/todo.txt";
		store.todoFile = todoFile;

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
		mockedToggleTodoItemCompleted.mockResolvedValue(toggledTodoFile);

		await toggleTodoItem(store, 1, "(A) Review workspace +Tuxedo");

		expect(mockedToggleTodoItemCompleted).toHaveBeenCalledWith(
			"/tmp/todos",
			1,
			"(A) Review workspace +Tuxedo"
		);
		expect(store.todoFile).toEqual(toggledTodoFile);
		expect(store.error).toBe("");
	});

	it("reports stale-line toggle errors without applying stale todo file data", async () => {
		const store = new WorkspaceStore();
		store.root = "/tmp/todos";
		store.todoPath = "/tmp/todos/todo.txt";
		store.todoFile = todoFile;
		mockedToggleTodoItemCompleted.mockRejectedValue(
			new Error(
				'todo line 1 changed on disk; expected "(A) Review workspace +Tuxedo", found "Updated task +Tuxedo"'
			)
		);

		await toggleTodoItem(store, 1, "(A) Review workspace +Tuxedo");

		expect(store.todoFile).toEqual(todoFile);
		expect(store.error).toBe(
			'todo line 1 changed on disk; expected "(A) Review workspace +Tuxedo", found "Updated task +Tuxedo"'
		);
	});

	it("reports an error when toggling without an open workspace", async () => {
		const store = new WorkspaceStore();

		await toggleTodoItem(store, 1, "(A) Review workspace +Tuxedo");

		expect(mockedToggleTodoItemCompleted).not.toHaveBeenCalled();
		expect(store.error).toBe("No workspace is open.");
	});
});
