import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	appendTodoItem,
	deleteTodoItem,
	toggleTodoItemCompleted,
	updateTodoItem,
} from "./workspace-api";
import type { WorkspaceMutationResult } from "$lib/modules/workspace/domain/workspace";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const mutationResult: WorkspaceMutationResult = {
	root: "/tmp/todos",
	todo_path: "/tmp/todos/todo.txt",
	todo_exists: true,
	todo_file: {
		path: "/tmp/todos/todo.txt",
		items: [
			{
				line_number: 1,
				raw: "Write tests +Tuxedo",
				completed: false,
				priority: null,
				creation_date: null,
				completion_date: null,
				description: "Write tests",
				projects: ["Tuxedo"],
				contexts: [],
				metadata: {},
			},
		],
		skipped: [],
	},
};

describe("workspace mutation API", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockedInvoke.mockResolvedValue(mutationResult);
	});

	it("appends a todo item and validates the reload response", async () => {
		await expect(appendTodoItem("/tmp/todos", "Write tests +Tuxedo")).resolves.toEqual(
			mutationResult
		);

		expect(mockedInvoke).toHaveBeenCalledWith("append_todo_item", {
			root: "/tmp/todos",
			raw: "Write tests +Tuxedo",
		});
	});

	it("updates a todo item with the stale raw-line guard", async () => {
		await expect(
			updateTodoItem("/tmp/todos", 2, "Old task +Tuxedo", "New task +Tuxedo")
		).resolves.toEqual(mutationResult);

		expect(mockedInvoke).toHaveBeenCalledWith("update_todo_item", {
			root: "/tmp/todos",
			lineNumber: 2,
			expectedRaw: "Old task +Tuxedo",
			raw: "New task +Tuxedo",
		});
	});

	it("toggles a todo item with the stale raw-line guard", async () => {
		await expect(toggleTodoItemCompleted("/tmp/todos", 3, "Open task +Tuxedo")).resolves.toEqual(
			mutationResult
		);

		expect(mockedInvoke).toHaveBeenCalledWith("toggle_todo_item_completed", {
			root: "/tmp/todos",
			lineNumber: 3,
			expectedRaw: "Open task +Tuxedo",
		});
	});

	it("deletes a todo item with the stale raw-line guard", async () => {
		await expect(deleteTodoItem("/tmp/todos", 4, "Delete task +Tuxedo")).resolves.toEqual(
			mutationResult
		);

		expect(mockedInvoke).toHaveBeenCalledWith("delete_todo_item", {
			root: "/tmp/todos",
			lineNumber: 4,
			expectedRaw: "Delete task +Tuxedo",
		});
	});

	it("throws a readable error when a mutation response drifts", async () => {
		mockedInvoke.mockResolvedValue({ ...mutationResult, todo_exists: "true" });

		await expect(appendTodoItem("/tmp/todos", "Write tests")).rejects.toThrow(
			/Unexpected workspace mutation response from Rust: todo_exists:/
		);
	});
});
