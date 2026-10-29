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
	it("scrolls a long column when a dragged card reaches its lower edge", async () => {
		const items = Array.from({ length: 30 }, (_, index) => ({
			...open,
			line_number: index + 1,
			description: `Item ${index + 1}`,
		}));
		render(TodoBoard, {
			items,
			today: "2026-10-28",
			disabled: false,
			onOpen: vi.fn(),
			onToggleComplete: vi.fn(),
			onMove: vi.fn(),
		});
		const handle = page.getByTitle("Drag Item 1").element();
		const viewport = page
			.getByRole("region", { name: "Unassigned Todo items" })
			.element() as HTMLElement;
		const transfer = new DataTransfer();
		handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
		const rect = viewport.getBoundingClientRect();
		viewport.dispatchEvent(
			new DragEvent("dragover", {
				bubbles: true,
				cancelable: true,
				dataTransfer: transfer,
				clientX: rect.left + 50,
				clientY: rect.bottom - 2,
			})
		);
		await expect.poll(() => viewport.scrollTop).toBeGreaterThan(0);
		handle.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
	});

	it("drops an open card onto another column and scrolls at the board edge", async () => {
		const onMove = vi.fn();
		render(TodoBoard, {
			items: [open],
			today: "2026-10-28",
			disabled: false,
			onOpen: vi.fn(),
			onToggleComplete: vi.fn(),
			onMove,
		});
		const handle = page.getByTitle("Drag Plan").element();
		const board = page.getByRole("region", { name: "Kanban board" }).element() as HTMLElement;
		const target = page.getByRole("region", { name: "To do", exact: true }).element();
		const transfer = new DataTransfer();
		handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
		const rect = board.getBoundingClientRect();
		target.dispatchEvent(
			new DragEvent("dragover", {
				bubbles: true,
				cancelable: true,
				dataTransfer: transfer,
				clientX: rect.right - 2,
				clientY: rect.top + 40,
			})
		);
		await expect.poll(() => board.scrollLeft).toBeGreaterThan(0);
		target.dispatchEvent(
			new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer })
		);
		expect(onMove).toHaveBeenCalledExactlyOnceWith(open, "to-do");
	});

	it("shows the last assignment, flags unknown values, and offers a keyboard move", async () => {
		const onMove = vi.fn();
		const assigned = {
			...open,
			line_number: 3,
			description: "Assigned",
			raw: "Assigned board:to-do board:in-progress/2",
		};
		const invalid = {
			...open,
			line_number: 4,
			description: "Imported",
			raw: "Imported board:future",
		};
		render(TodoBoard, {
			items: [open, assigned, invalid],
			today: "2026-10-28",
			disabled: false,
			onOpen: vi.fn(),
			onToggleComplete: vi.fn(),
			onMove,
		});
		await expect
			.element(
				page
					.getByRole("region", { name: "In progress" })
					.getByRole("button", { name: "Open Assigned" })
			)
			.toBeVisible();
		const unassigned = page.getByRole("region", { name: "Unassigned", exact: true });
		await expect
			.element(unassigned.getByRole("button", { name: "Open Imported" }))
			.toHaveAccessibleDescription(/Invalid board assignment/);
		const trigger = unassigned.getByRole("button", { name: "Move Imported" });
		(trigger.element() as HTMLElement).focus();
		await userEvent.keyboard("{Enter}");
		await page.getByRole("menuitem", { name: "To do" }).click();
		expect(onMove).toHaveBeenCalledExactlyOnceWith(invalid, "to-do", trigger.element());
	});

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

	it("opens details when the card padding is clicked", async () => {
		const onOpen = vi.fn();
		render(TodoBoard, {
			items: [open],
			today: "2026-10-28",
			disabled: false,
			onOpen,
			onToggleComplete: vi.fn(),
		});
		const card = page.getByRole("button", { name: "Open Plan" }).element().closest("article")!;
		await userEvent.click(card, { position: { x: 4, y: 4 } });
		expect(onOpen).toHaveBeenCalledOnce();
	});

	it("keeps the item and checkbox click targets separate", async () => {
		const onOpen = vi.fn();
		const onToggleComplete = vi.fn();
		render(TodoBoard, {
			items: [open],
			today: "2026-10-28",
			disabled: false,
			onOpen,
			onToggleComplete,
		});
		const openButton = page.getByRole("button", { name: "Open Plan" });
		const buttonRect = openButton.element().getBoundingClientRect();
		const card = openButton.element().closest("article")!;
		const cardRect = card.getBoundingClientRect();
		await userEvent.click(card, {
			position: { x: buttonRect.left - cardRect.left + 2, y: buttonRect.top - cardRect.top + 8 },
		});
		expect(onOpen).toHaveBeenCalledOnce();
		expect(onToggleComplete).not.toHaveBeenCalled();
		await page.getByRole("checkbox", { name: "Mark Plan complete" }).click();
		expect(onToggleComplete).toHaveBeenCalledOnce();
		expect(onOpen).toHaveBeenCalledOnce();
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
		const openScroll = page.getByRole("region", { name: "Unassigned Todo items" }).element();
		const doneScroll = page.getByRole("region", { name: "Done Todo items" }).element();
		const header = unassigned.querySelector("header")!;
		const top = header.getBoundingClientRect().top;

		expect(board.scrollWidth).toBeGreaterThan(board.clientWidth);
		expect(openScroll.scrollHeight).toBeGreaterThan(openScroll.clientHeight);
		await page.getByRole("region", { name: "Unassigned Todo items" }).hover();
		await expect
			.poll(
				() =>
					!!board.parentElement?.querySelector(
						':scope > [data-slot="scroll-area-scrollbar"][data-orientation="horizontal"]'
					)
			)
			.toBe(true);
		await expect
			.poll(
				() =>
					!!openScroll.parentElement?.querySelector(
						':scope > [data-slot="scroll-area-scrollbar"][data-orientation="vertical"]'
					)
			)
			.toBe(true);
		(openScroll as HTMLElement).focus();
		await userEvent.keyboard("{ArrowDown}");
		await expect.poll(() => openScroll.scrollTop).toBeGreaterThan(0);
		expect(doneScroll.scrollTop).toBe(0);
		expect(header.getBoundingClientRect().top).toBe(top);
	});

	it("lets keyboard users scroll to empty off-screen columns", async () => {
		render(TodoBoard, {
			items: [],
			today: "2026-10-28",
			disabled: false,
			onOpen: vi.fn(),
			onToggleComplete: vi.fn(),
		});
		const board = page.getByRole("region", { name: "Kanban board" });
		await userEvent.keyboard("{Tab}");
		await expect.element(board).toHaveFocus();
		await userEvent.keyboard("{ArrowRight}");
		await expect.poll(() => (board.element() as HTMLElement).scrollLeft).toBeGreaterThan(0);
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

	it("virtualizes each column, measures card heights, and clamps scrolling after filtering", async () => {
		const openItems = Array.from({ length: 200 }, (_, index) => ({
			...open,
			line_number: index + 1,
			description: `Open item ${index + 1}${index === 0 ? " with a much longer description that wraps over several lines of the card" : ""}`,
		}));
		const doneItems = Array.from({ length: 200 }, (_, index) => ({
			...legacyCompleted,
			line_number: index + 201,
			description: `Completed item ${index + 1}`,
		}));
		const props = {
			items: [...openItems, ...doneItems],
			today: "2026-10-28",
			disabled: false,
			onOpen: vi.fn(),
			onToggleComplete: vi.fn(),
		};
		const view = await render(TodoBoard, props);
		const unassigned = page.getByRole("region", { name: "Unassigned", exact: true }).element();
		const done = page.getByRole("region", { name: "Done", exact: true }).element();
		const openScroll = page
			.getByRole("region", { name: "Unassigned Todo items" })
			.element() as HTMLElement;
		const doneScroll = page
			.getByRole("region", { name: "Done Todo items" })
			.element() as HTMLElement;
		await expect.element(page.getByRole("button", { name: /^Open Open item 1 / })).toBeVisible();
		expect(unassigned.querySelector("header span")?.textContent).toBe("200");
		expect(done.querySelector("header span")?.textContent).toBe("200");
		expect(openScroll.querySelectorAll("li").length).toBeLessThan(20);
		expect(doneScroll.querySelectorAll("li").length).toBeLessThan(20);
		expect(openScroll.querySelector("li")?.getAttribute("aria-setsize")).toBe("200");
		await expect
			.poll(() => {
				const cards = openScroll.querySelectorAll("article");
				const first = cards[0]?.getBoundingClientRect();
				const second = cards[1]?.getBoundingClientRect();
				return first && second ? Math.round(second.top - first.bottom) : -1;
			})
			.toBeGreaterThanOrEqual(8);
		const initialHeight = openScroll.querySelector("article")!.getBoundingClientRect().height;
		const resized = {
			...openItems[0],
			description: `${openItems[0].description} ${"More wrapping text ".repeat(12)}`,
		};
		await view.rerender({ ...props, items: [resized, ...openItems.slice(1), ...doneItems] });
		await expect
			.poll(() => openScroll.querySelector("article")!.getBoundingClientRect().height)
			.toBeGreaterThan(initialHeight);
		await expect
			.poll(() => {
				const cards = openScroll.querySelectorAll("article");
				return Math.round(
					cards[1].getBoundingClientRect().top - cards[0].getBoundingClientRect().bottom
				);
			})
			.toBeGreaterThanOrEqual(8);

		await view.component.focusTodo(openItems[150]);
		await expect.element(page.getByRole("button", { name: "Open Open item 151" })).toHaveFocus();
		expect(openScroll.scrollTop).toBeGreaterThan(0);
		openScroll.scrollTop = openScroll.scrollHeight;
		await expect.element(page.getByRole("button", { name: "Open Open item 200" })).toBeVisible();
		expect(doneScroll.scrollTop).toBe(0);
		doneScroll.scrollTop = doneScroll.scrollHeight;
		await expect
			.element(page.getByRole("button", { name: "Open Completed item 200" }))
			.toBeInTheDocument();
		expect(doneScroll.querySelectorAll("li").length).toBeLessThan(20);

		await view.rerender({ ...props, items: [openItems[1]] });
		await expect.element(page.getByRole("button", { name: "Open Open item 2" })).toBeVisible();
		await expect.poll(() => openScroll.scrollTop).toBe(0);
	});

	it("keeps a focused card and its neighbors available across the virtual window", async () => {
		const items = Array.from({ length: 100 }, (_, index) => ({
			...open,
			line_number: index + 1,
			description: `Item ${index + 1}`,
		}));
		await render(TodoBoard, {
			items,
			today: "2026-10-28",
			disabled: false,
			onOpen: vi.fn(),
			onToggleComplete: vi.fn(),
		});
		const first = page.getByRole("button", { name: "Open Item 1" });
		(first.element() as HTMLElement).focus();
		const viewport = page
			.getByRole("region", { name: "Unassigned Todo items" })
			.element() as HTMLElement;
		viewport.scrollTop = viewport.scrollHeight;
		await expect.element(page.getByRole("button", { name: "Open Item 100" })).toBeVisible();
		await expect.element(first).toHaveFocus();
		await userEvent.keyboard("{Tab}");
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Item 2 complete" }))
			.toHaveFocus();
		await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
		await expect.element(first).toHaveFocus();
	});

	it("reveals and focuses a completed card outside the destination column's window", async () => {
		const doneItems = Array.from({ length: 150 }, (_, index) => ({
			...legacyCompleted,
			line_number: index + 1,
			description: `Completed item ${index + 1}`,
		}));
		const target = { ...open, line_number: 151 };
		render(TodoBoardFocusHarness, {
			initialItems: [...doneItems, target],
			complete: async () => "applied",
		});
		await page.getByRole("checkbox", { name: "Mark Plan complete" }).click();
		const completed = page.getByRole("checkbox", { name: "Mark Plan incomplete" });
		await expect.element(completed).toHaveFocus();
		const doneScroll = page.getByRole("region", { name: "Done Todo items" }).element();
		expect(doneScroll.scrollTop).toBeGreaterThan(0);
		await expect
			.poll(() => {
				const card = completed.element().getBoundingClientRect();
				const viewport = doneScroll.getBoundingClientRect();
				return card.top >= viewport.top && card.bottom <= viewport.bottom;
			})
			.toBe(true);
	});
});
