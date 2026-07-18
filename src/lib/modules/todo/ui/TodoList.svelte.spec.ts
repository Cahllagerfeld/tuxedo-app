import { page } from "vitest/browser";
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
