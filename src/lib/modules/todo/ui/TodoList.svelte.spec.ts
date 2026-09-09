import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { TodoFile } from "../domain/todo";
import TodoList from "./TodoList.svelte";

const todoFile: TodoFile = {
	path: "/tmp/work.todo",
	skipped: [],
	items: [
		{
			line_number: 1,
			raw: "(A) Plan +Tuxedo @desk due:2026-07-12",
			completed: false,
			priority: "A",
			creation_date: "2026-07-10",
			completion_date: null,
			description: "Plan",
			projects: ["Tuxedo"],
			contexts: ["desk"],
			metadata: { due: "2026-07-12" },
		},
		{
			line_number: 2,
			raw: "x 2026-07-11 2026-07-10 Ship release",
			completed: true,
			priority: null,
			creation_date: "2026-07-10",
			completion_date: "2026-07-11",
			description: "Ship release",
			projects: [],
			contexts: [],
			metadata: {},
		},
	],
};

describe("TodoList", () => {
	it("renders parsed Todo items with useful scan details and completion controls", async () => {
		render(TodoList, {
			todoFile,
			disabled: false,
			onToggleComplete: vi.fn(),
			onDelete: vi.fn(),
		});

		await expect.element(page.getByRole("list", { name: "Todo items" })).toBeVisible();
		const items = page.getByRole("listitem");
		await expect.element(items.nth(0)).toHaveTextContent("Plan");
		await expect.element(items.nth(1)).toHaveTextContent("Ship release");
		await expect.element(page.getByText("(A)", { exact: true })).toBeVisible();
		await expect.element(page.getByText("+Tuxedo", { exact: true })).toBeVisible();
		await expect.element(page.getByText("@desk", { exact: true })).toBeVisible();
		await expect.element(page.getByText("due:2026-07-12", { exact: true })).toBeVisible();
		await expect.element(page.getByText("Completed 2026-07-11", { exact: true })).toBeVisible();
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Plan complete" }))
			.not.toBeChecked();
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Ship release incomplete" }))
			.toBeChecked();
		await expect.element(page.getByRole("button", { name: "Delete Plan" })).toBeInTheDocument();
		await expect
			.element(page.getByRole("button", { name: "Delete Ship release" }))
			.toBeInTheDocument();
	});

	it("moves row focus with arrows and Home/End without wrapping", async () => {
		render(TodoList, {
			todoFile,
			disabled: false,
			onToggleComplete: vi.fn(),
			onDelete: vi.fn(),
		});

		const rows = page.getByRole("listitem");
		await userEvent.click(rows.nth(0));
		await userEvent.keyboard("{ArrowDown}");
		await expect.element(rows.nth(1)).toHaveFocus();
		await userEvent.keyboard("{ArrowDown}");
		await expect.element(rows.nth(1)).toHaveFocus();
		await userEvent.keyboard("{Home}");
		await expect.element(rows.nth(0)).toHaveFocus();
		await userEvent.keyboard("{ArrowUp}");
		await expect.element(rows.nth(0)).toHaveFocus();
		await userEvent.keyboard("{End}");
		await expect.element(rows.nth(1)).toHaveFocus();
	});

	it("toggles the focused row once with Space but preserves native nested controls", async () => {
		const onToggleComplete = vi.fn();
		render(TodoList, {
			todoFile,
			disabled: false,
			onToggleComplete,
			onDelete: vi.fn(),
		});

		const firstRow = page.getByRole("listitem").nth(0);
		await userEvent.click(firstRow);
		await userEvent.keyboard(" ");
		expect(onToggleComplete).toHaveBeenCalledOnce();
		expect(onToggleComplete).toHaveBeenCalledWith(todoFile.items[0]);

		onToggleComplete.mockClear();
		await userEvent.tab();
		await expect.element(page.getByRole("checkbox", { name: "Mark Plan complete" })).toHaveFocus();
		await userEvent.keyboard(" ");
		expect(onToggleComplete).toHaveBeenCalledOnce();
	});

	it("renders a Todo-file-specific empty state when no valid items were parsed", async () => {
		render(TodoList, {
			todoFile: { ...todoFile, items: [] },
			disabled: false,
			onToggleComplete: vi.fn(),
			onDelete: vi.fn(),
		});

		await expect.element(page.getByLabelText("No valid Todo items")).toBeVisible();
		await expect.element(page.getByText("No valid Todo items", { exact: true })).toBeVisible();
		await expect
			.element(page.getByText("This Todo file did not contain any parsed Todo items."))
			.toBeVisible();
	});
});
