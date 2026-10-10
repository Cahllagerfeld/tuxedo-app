import { page, userEvent } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { TodoFile } from "../domain/todo";
import TodoList from "./TodoListHarness.svelte";
import "../../../../routes/layout.css";

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
	beforeEach(async () => {
		await page.viewport(800, 600);
	});
	it("bounds rendered Todo items and reaches offscreen completion and deletion controls", async () => {
		const items = Array.from({ length: 1000 }, (_, index) => ({
			...todoFile.items[0],
			line_number: index + 1,
			description: `Todo item ${index + 1}`,
		}));
		const onToggleComplete = vi.fn();
		const onDelete = vi.fn();
		render(TodoList, {
			todoFile: { ...todoFile, items },
			disabled: false,
			onToggleComplete,
			onDelete,
		});
		await expect.element(page.getByText("Todo item 1", { exact: true })).toBeVisible();
		const list = page.getByRole("list", { name: "Todo items" }).element();
		const initialRenderedCount = list.children.length;
		expect(list.children.length).toBeLessThan(30);
		expect(list.children[0]).toHaveAttribute("aria-setsize", "1000");
		expect(list.children[0]).toHaveAttribute("aria-posinset", "1");
		await expect.element(page.getByText("Todo item 1000", { exact: true })).not.toBeInTheDocument();
		const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
		viewport.scrollTop = viewport.scrollHeight;
		await expect.element(page.getByText("Todo item 1000", { exact: true })).toBeVisible();
		expect(list.children.length).toBeLessThan(30);
		await page.getByRole("checkbox", { name: "Mark Todo item 1000 complete", exact: true }).click();
		expect(onToggleComplete).toHaveBeenCalledWith(items[999]);
		await page.getByRole("button", { name: "Delete Todo item 1000", exact: true }).click();
		expect(onDelete).toHaveBeenCalledWith(items[999]);
		viewport.scrollTop = 0;
		await expect.element(page.getByText("Todo item 1", { exact: true })).toBeVisible();
		viewport.closest<HTMLElement>('[data-slot="scroll-area"]')!.style.height = "200px";
		await expect.poll(() => list.children.length).toBeLessThan(initialRenderedCount);
	});

	it("updates filtered items and clamps the viewport after a scrolled list shrinks", async () => {
		const items = Array.from({ length: 1000 }, (_, index) => ({
			...todoFile.items[0],
			line_number: index + 1,
			description: `Todo item ${index + 1}`,
		}));
		const props = {
			todoFile: { ...todoFile, items },
			disabled: false,
			onToggleComplete: vi.fn(),
			onDelete: vi.fn(),
		};
		const view = await render(TodoList, props);
		await expect.element(page.getByText("Todo item 1", { exact: true })).toBeVisible();
		const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
		viewport.scrollTop = viewport.scrollHeight;
		await expect.element(page.getByText("Todo item 1000", { exact: true })).toBeVisible();
		await view.rerender({ ...props, items: [items[500]] });
		await expect.element(page.getByText("Todo item 501", { exact: true })).toBeVisible();
		expect(viewport.scrollTop).toBe(0);
		await expect.element(page.getByRole("listitem")).toHaveAttribute("aria-setsize", "1");
		await view.rerender({ ...props, items: [items[600]] });
		await expect.element(page.getByText("Todo item 601", { exact: true })).toBeVisible();
		await expect.element(page.getByText("Todo item 501", { exact: true })).not.toBeInTheDocument();
		await view.rerender({ ...props, items: [] });
		await expect.element(page.getByLabelText("No valid Todo items")).toBeVisible();
		await view.rerender({ ...props, items });
		await expect.element(page.getByText("Todo item 1", { exact: true })).toBeVisible();
		viewport.scrollTop = viewport.scrollHeight;
		await expect.element(page.getByText("Todo item 1000", { exact: true })).toBeVisible();
		await view.rerender({
			...props,
			todoFile: { ...props.todoFile, path: "/tmp/other.todo" },
			items,
		});
		await expect.element(page.getByText("Todo item 1", { exact: true })).toBeVisible();
		expect(viewport.scrollTop).toBe(0);
	});

	it("keeps keyboard focus mounted and tabs beyond the initial rendered range", async () => {
		const items = Array.from({ length: 1000 }, (_, index) => ({
			...todoFile.items[0],
			line_number: index + 1,
			description: `Todo item ${index + 1}`,
		}));
		render(TodoList, {
			todoFile: { ...todoFile, items },
			disabled: false,
			onToggleComplete: vi.fn(),
			onDelete: vi.fn(),
		});
		const first = page.getByRole("checkbox", { name: "Mark Todo item 1 complete", exact: true });
		await expect.element(first).toBeVisible();
		(first.element() as HTMLElement).focus();
		await userEvent.keyboard("{Tab}".repeat(40));
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Todo item 21 complete", exact: true }))
			.toHaveFocus();
		const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
		viewport.scrollTop = viewport.scrollHeight;
		await expect.element(page.getByText("Todo item 1000", { exact: true })).toBeVisible();
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Todo item 21 complete", exact: true }))
			.toHaveFocus();
		expect(page.getByRole("list", { name: "Todo items" }).element().children.length).toBeLessThan(
			30
		);
	});

	it("renders compact Todo items with inline facets and completion controls", async () => {
		render(TodoList, {
			todoFile,
			disabled: false,
			onToggleComplete: vi.fn(),
			onDelete: vi.fn(),
		});

		await expect.element(page.getByRole("list", { name: "Todo items" })).toBeVisible();
		const items = page.getByRole("listitem");
		await expect.element(items.nth(0)).toMatchTextContent("Plan");
		await expect.element(items.nth(1)).toMatchTextContent("Ship release");
		await expect.element(page.getByText("(A)", { exact: true })).toBeVisible();
		await expect.element(page.getByText("+Tuxedo", { exact: true })).toBeVisible();
		await expect.element(page.getByText("@desk", { exact: true })).toBeVisible();
		await expect.element(page.getByText("due:2026-07-12", { exact: true })).not.toBeInTheDocument();
		await expect
			.element(page.getByText("Completed 2026-07-11", { exact: true }))
			.not.toBeInTheDocument();
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
