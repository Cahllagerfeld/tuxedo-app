import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { TodoItem } from "../domain/todo";
import TodoBoard from "./TodoBoardHarness.svelte";
import TodoBoardFocusHarness from "./TodoBoardFocusHarness.svelte";
import "../../../../routes/layout.css";

const open: TodoItem = {
	line_number: 1,
	raw: "(A) Plan +Tuxedo @desk due:2026-10-30 rec:1w",
	completed: false,
	priority: "A",
	creation_date: null,
	completion_date: null,
	description: "Plan",
	projects: ["Tuxedo"],
	contexts: ["desk"],
	metadata: { due: "2026-10-30", rec: "1w" },
	edit: { description: "Plan", metadata: ["due:2026-10-30", "rec:1w"] },
};
const legacyCompleted: TodoItem = {
	...open,
	line_number: 2,
	raw: "x Ship release",
	completed: true,
	priority: null,
	description: "Ship release",
	projects: [],
	contexts: [],
	metadata: {},
	edit: { description: "Ship release", metadata: [] },
};

describe("TodoBoard", () => {
	it("places open and legacy completed Todo items in the fixed columns", async () => {
		render(TodoBoard, {
			items: [open, legacyCompleted],
			today: "2026-10-28",
			disabled: false,
			onOpen: vi.fn(),
			onToggleComplete: vi.fn(),
		});

		const unassigned = page.getByRole("region", { name: "Unassigned", exact: true });
		const todo = page.getByRole("region", { name: "To do", exact: true });
		const inProgress = page.getByRole("region", { name: "In progress", exact: true });
		const done = page.getByRole("region", { name: "Done", exact: true });
		await expect.element(unassigned.getByRole("button", { name: "Open Plan" })).toBeVisible();
		await expect.element(done.getByRole("button", { name: "Open Ship release" })).toBeVisible();
		await expect.element(todo).toBeVisible();
		await expect.element(inProgress).toBeVisible();
		expect(todo.getByRole("button", { name: /^Open / }).elements()).toHaveLength(0);
		expect(inProgress.getByRole("button", { name: /^Open / }).elements()).toHaveLength(0);
	});

	it("shows key indicators, opens details by keyboard, and requests completion separately", async () => {
		const onOpen = vi.fn();
		const onToggleComplete = vi.fn();
		render(TodoBoard, {
			items: [open],
			today: "2026-10-28",
			disabled: false,
			onOpen,
			onToggleComplete,
		});

		await expect.element(page.getByTitle("Priority")).toBeVisible();
		await expect.element(page.getByText("+Tuxedo", { exact: true })).toBeVisible();
		await expect.element(page.getByText("@desk", { exact: true })).toBeVisible();
		await expect.element(page.getByText("Due 2026-10-30", { exact: true })).toBeVisible();
		await expect.element(page.getByTitle("Recurrence: 1 week")).toBeVisible();

		const checkbox = page.getByRole("checkbox", { name: "Mark Plan complete" });
		await checkbox.click();
		expect(onToggleComplete).toHaveBeenCalledWith(open);
		expect(onOpen).not.toHaveBeenCalled();
		await expect.element(checkbox).not.toBeChecked();

		const card = page.getByRole("button", { name: "Open Plan" });
		await expect
			.element(card)
			.toHaveAccessibleDescription(/Priority.*\+Tuxedo.*@desk.*Recurring.*Due 2026-10-30/);
		(card.element() as HTMLElement).focus();
		await userEvent.keyboard("{Enter}");
		expect(onOpen).toHaveBeenCalledWith(open, card.element());
	});

	it("scrolls the board horizontally and each column independently while headers stay visible", async () => {
		const openItems = Array.from({ length: 12 }, (_, index) => ({
			...open,
			line_number: index + 1,
			description: `Open item ${index + 1}`,
		}));
		const doneItems = Array.from({ length: 12 }, (_, index) => ({
			...legacyCompleted,
			line_number: index + 13,
			description: `Completed item ${index + 1}`,
		}));
		render(TodoBoard, {
			items: [...openItems, ...doneItems],
			today: "2026-10-28",
			disabled: false,
			onOpen: vi.fn(),
			onToggleComplete: vi.fn(),
		});
		const board = page.getByLabelText("Kanban board").element() as HTMLElement;
		const unassigned = page.getByRole("region", { name: "Unassigned", exact: true }).element();
		const done = page.getByRole("region", { name: "Done", exact: true }).element();
		const openScroll = unassigned.querySelector("div")!;
		const doneScroll = done.querySelector("div")!;
		const header = unassigned.querySelector("header")!;
		const top = header.getBoundingClientRect().top;

		expect(board.scrollWidth).toBeGreaterThan(board.clientWidth);
		expect(openScroll.scrollHeight).toBeGreaterThan(openScroll.clientHeight);
		openScroll.scrollTop = openScroll.scrollHeight;
		expect(openScroll.scrollTop).toBeGreaterThan(0);
		expect(doneScroll.scrollTop).toBe(0);
		expect(header.getBoundingClientRect().top).toBe(top);
	});

	it("returns focus to a card after completion moves it to Done, or to the board after a conflict", async () => {
		const first = Promise.withResolvers<"applied" | "conflict">();
		const second = Promise.withResolvers<"applied" | "conflict">();
		const complete = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		render(TodoBoardFocusHarness, { initialItems: [open], complete });

		await page.getByRole("checkbox", { name: "Mark Plan complete" }).click();
		first.resolve("applied");
		const completed = page.getByRole("checkbox", { name: "Mark Plan incomplete" });
		await expect.element(completed).toHaveFocus();
		await completed.click();
		second.resolve("conflict");
		await expect.element(page.getByLabelText("Kanban board")).toHaveFocus();
	});

	it("does not steal focus when the user moves away while completion is pending", async () => {
		const response = Promise.withResolvers<"applied" | "conflict">();
		render(TodoBoardFocusHarness, { initialItems: [open], complete: () => response.promise });
		await page.getByRole("checkbox", { name: "Mark Plan complete" }).click();
		const other = page.getByRole("button", { name: "Other control" });
		await other.click();
		response.resolve("applied");
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Plan incomplete" }))
			.toBeVisible();
		await expect.element(other).toHaveFocus();
	});
});
