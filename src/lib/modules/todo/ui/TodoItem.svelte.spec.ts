import { AppState } from "$lib/app/app-state.svelte";
import type { TodoItem as TodoItemData } from "$lib/modules/todo/domain/todo";
import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import TodoItemComponent from "./TodoItem.svelte";

let appState: AppState;

vi.mock("$lib/app/app-context", () => ({
	getAppState: () => appState,
}));

vi.mock("$lib/modules/workspace/state/workspace-actions", () => ({
	toggleTodoItem: vi.fn().mockResolvedValue(undefined),
}));

import { toggleTodoItem } from "$lib/modules/workspace/state/workspace-actions";

const mockedToggleTodoItem = vi.mocked(toggleTodoItem);

const openTodo: TodoItemData = {
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
};

const completedTodo: TodoItemData = {
	...openTodo,
	completed: true,
	completion_date: "2026-06-14",
	raw: "x 2026-06-14 (A) Review workspace +Tuxedo",
};

describe("TodoItem.svelte", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		appState = new AppState();
		appState.workspace.root = "/tmp/todos";
		appState.workspace.todoPath = "/tmp/todos/todo.txt";
		appState.workspace.todoFile = {
			path: "/tmp/todos/todo.txt",
			items: [openTodo],
			skipped: [],
		};
	});

	it("renders open tasks with a mark-complete checkbox", async () => {
		render(TodoItemComponent, { todo: openTodo });

		const checkbox = page.getByRole("checkbox", { name: "Mark task complete" });
		await expect.element(checkbox).toBeInTheDocument();
		await expect.element(checkbox).not.toBeChecked();
	});

	it("renders completed tasks with a mark-incomplete checkbox", async () => {
		render(TodoItemComponent, { todo: completedTodo });

		const checkbox = page.getByRole("checkbox", { name: "Mark task incomplete" });
		await expect.element(checkbox).toBeInTheDocument();
		await expect.element(checkbox).toBeChecked();
	});

	it("toggles completion through workspace actions when the checkbox is clicked", async () => {
		render(TodoItemComponent, { todo: openTodo });

		await page.getByRole("checkbox", { name: "Mark task complete" }).click();

		expect(mockedToggleTodoItem).toHaveBeenCalledWith(
			appState.workspace,
			1,
			"(A) Review workspace +Tuxedo"
		);
	});
});
