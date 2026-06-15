import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkspaceTodo } from "./workspace-api";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("workspace API", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("resolves workspace todo path and validates the response", async () => {
		const resolution = {
			root: "/tmp/todos",
			todo_path: "/tmp/todos/todo.txt",
			todo_exists: true,
		};
		mockedInvoke.mockResolvedValue(resolution);

		await expect(resolveWorkspaceTodo("/tmp/todos")).resolves.toEqual(resolution);

		expect(mockedInvoke).toHaveBeenCalledWith("resolve_workspace_todo", {
			root: "/tmp/todos",
		});
	});

	it("throws a readable error when resolution response drifts", async () => {
		mockedInvoke.mockResolvedValue({
			root: "/tmp/todos",
			todo_path: "/tmp/todos/todo.txt",
			todo_exists: "true",
		});

		await expect(resolveWorkspaceTodo("/tmp/todos")).rejects.toThrow(
			/Unexpected workspace todo resolution response from Rust: todo_exists:/
		);
	});
});
