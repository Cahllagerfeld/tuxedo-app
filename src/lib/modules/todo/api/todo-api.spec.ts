import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	appendTodoItem,
	deleteTodoItem,
	parseTodoFile,
	toggleTodoItemCompleted,
	updateTodoItem,
} from "./todo-api";
import type { TodoFile } from "$lib/modules/todo/domain/todo";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const todoFile: TodoFile = {
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
};

describe("todo API", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockedInvoke.mockResolvedValue(todoFile);
	});

	it("parses a todo file and validates the response", async () => {
		await expect(parseTodoFile("/tmp/todos/todo.txt")).resolves.toEqual(todoFile);

		expect(mockedInvoke).toHaveBeenCalledWith("parse_todo_file", {
			path: "/tmp/todos/todo.txt",
		});
	});

	it("appends a todo item and validates the mutation response", async () => {
		await expect(appendTodoItem("/tmp/todos", "Write tests +Tuxedo")).resolves.toEqual(todoFile);

		expect(mockedInvoke).toHaveBeenCalledWith("append_todo_item", {
			root: "/tmp/todos",
			raw: "Write tests +Tuxedo",
		});
	});

	it("updates a todo item with the stale raw-line guard", async () => {
		await expect(
			updateTodoItem("/tmp/todos", 2, "Old task +Tuxedo", "New task +Tuxedo")
		).resolves.toEqual(todoFile);

		expect(mockedInvoke).toHaveBeenCalledWith("update_todo_item", {
			root: "/tmp/todos",
			lineNumber: 2,
			expectedRaw: "Old task +Tuxedo",
			raw: "New task +Tuxedo",
		});
	});

	it("toggles a todo item with the stale raw-line guard", async () => {
		await expect(toggleTodoItemCompleted("/tmp/todos", 3, "Open task +Tuxedo")).resolves.toEqual(
			todoFile
		);

		expect(mockedInvoke).toHaveBeenCalledWith("toggle_todo_item_completed", {
			root: "/tmp/todos",
			lineNumber: 3,
			expectedRaw: "Open task +Tuxedo",
		});
	});

	it("deletes a todo item with the stale raw-line guard", async () => {
		await expect(deleteTodoItem("/tmp/todos", 4, "Delete task +Tuxedo")).resolves.toEqual(
			todoFile
		);

		expect(mockedInvoke).toHaveBeenCalledWith("delete_todo_item", {
			root: "/tmp/todos",
			lineNumber: 4,
			expectedRaw: "Delete task +Tuxedo",
		});
	});

	it("throws a readable error when a mutation response drifts", async () => {
		mockedInvoke.mockResolvedValue({ ...todoFile, path: 123 });

		await expect(appendTodoItem("/tmp/todos", "Write tests")).rejects.toThrow(
			/Unexpected todo file response from Rust: path:/
		);
	});
});
