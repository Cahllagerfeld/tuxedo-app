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

			edit: { description: "Plan", metadata: ["due:2026-07-12"] },
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

			edit: { description: "Ship release", metadata: [] },
		},
	],
};

describe("TodoList", () => {
	it("shows due dates with urgency only for open Todo items and identifies malformed dates", async () => {
		const items = [
			{ ...todoFile.items[0], metadata: { due: "2026-10-13" } },
			{ ...todoFile.items[0], line_number: 2, metadata: { due: "2026-10-14" } },
			{ ...todoFile.items[1], line_number: 3, metadata: { due: "2026-10-13" } },
			{ ...todoFile.items[0], line_number: 4, metadata: { due: "2026-02-30" } },
		];
		render(TodoList, {
			todoFile: { ...todoFile, items },
			today: "2026-10-14",
			disabled: false,
			onToggleComplete: vi.fn(),
			onDelete: vi.fn(),
		});
		await expect.element(page.getByTitle("Overdue · 2026-10-13", { exact: true })).toBeVisible();
		await expect.element(page.getByTitle("Today · 2026-10-14", { exact: true })).toBeVisible();
		await expect.element(page.getByText("2026-07-11", { exact: true })).toBeVisible();
		await expect
			.element(page.getByRole("button", { name: "Invalid due date", exact: true }))
			.toBeVisible();
		expect(document.querySelectorAll("time")).toHaveLength(3);
		await expect
			.element(page.getByText("Invalid due date: 2026-02-30", { exact: true }))
			.not.toBeInTheDocument();
	});
	it("shows the invalid Due date tooltip on hover and keyboard focus", async () => {
		await render(TodoList, {
			todoFile: { ...todoFile, items: [{ ...todoFile.items[0], metadata: { due: "broken" } }] },
			disabled: false,
			onToggleComplete: vi.fn(),
			onDelete: vi.fn(),
		});
		const warning = page.getByRole("button", { name: "Invalid due date", exact: true });
		await warning.hover();
		await expect
			.element(page.getByRole("tooltip"))
			.toHaveTextContent("Invalid due date — edit this Todo item to repair it.");
		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByRole("tooltip")).not.toBeInTheDocument();
		await page.getByRole("checkbox", { name: "Mark Plan complete", exact: true }).click();
		await userEvent.keyboard("{Tab}");
		await expect.element(warning).toHaveFocus();
		await expect.element(page.getByRole("tooltip")).toBeVisible();
	});
	beforeEach(async () => {
		await page.viewport(800, 600);
	});
	it("renders repeated Projects and Contexts once and keeps completion available", async () => {
		const item = {
			...todoFile.items[0],
			raw: "Plan +Tuxedo +Tuxedo @desk @desk",
			projects: ["Tuxedo", "Tuxedo"],
			contexts: ["desk", "desk"],
		};
		const onToggleComplete = vi.fn();
		await render(TodoList, {
			todoFile: { ...todoFile, items: [item] },
			disabled: false,
			onToggleComplete,
			onDelete: vi.fn(),
		});
		await expect.element(page.getByText("+Tuxedo", { exact: true })).toBeVisible();
		await expect.element(page.getByText("@desk", { exact: true })).toBeVisible();
		expect(page.getByText("+Tuxedo", { exact: true }).elements()).toHaveLength(1);
		expect(page.getByText("@desk", { exact: true }).elements()).toHaveLength(1);
		await page.getByRole("checkbox", { name: "Mark Plan complete", exact: true }).click();
		expect(onToggleComplete).toHaveBeenCalledWith(item);
	});
	it("budgets tags across Projects and Contexts and leaves legacy completed rows undated", async () => {
		const item = {
			...todoFile.items[0],
			projects: ["One", "Two", "Three", "One"],
			contexts: ["desk", "home"],
		};
		await render(TodoList, {
			todoFile: {
				...todoFile,
				items: [
					item,
					{ ...todoFile.items[1], completion_date: null, metadata: { due: "2026-07-12" } },
				],
			},
			disabled: false,
			onToggleComplete: vi.fn(),
			onDelete: vi.fn(),
		});
		await expect.element(page.getByText("+One", { exact: true })).toBeVisible();
		await expect.element(page.getByText("@desk", { exact: true })).toBeVisible();
		const projectOverflow = page.getByRole("button", { name: "2 more Projects", exact: true });
		const contextOverflow = page.getByRole("button", { name: "1 more Contexts", exact: true });
		await expect.element(projectOverflow).toHaveTextContent("+2");
		await expect.element(contextOverflow).toHaveTextContent("+1");
		expect(getComputedStyle(projectOverflow.element()).color).toBe(
			getComputedStyle(page.getByText("+One", { exact: true }).element()).color
		);
		expect(getComputedStyle(contextOverflow.element()).color).toBe(
			getComputedStyle(page.getByText("@desk", { exact: true }).element()).color
		);
		expect(getComputedStyle(projectOverflow.element()).color).not.toBe(
			getComputedStyle(contextOverflow.element()).color
		);
		await expect.element(page.getByText("+Two", { exact: true })).not.toBeInTheDocument();
		await expect.element(page.getByText("@home", { exact: true })).not.toBeInTheDocument();
		expect(document.querySelectorAll("time")).toHaveLength(1);
		await projectOverflow.hover();
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("+Two+Three");
		await userEvent.keyboard("{Escape}");
		await contextOverflow.hover();
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("@home");
		await userEvent.keyboard("{Escape}");
		await page.getByRole("checkbox", { name: "Mark Plan complete", exact: true }).click();
		await userEvent.keyboard("{Tab}");
		await expect.element(projectOverflow).toHaveFocus();
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("+Two+Three");
	});
	it.each(["Projects", "Contexts"] as const)(
		"shows two visible %s when the other group is absent",
		async (group) => {
			const values = ["One", "Two", "Three", "Four", "One"];
			const prefix = group === "Projects" ? "+" : "@";
			await render(TodoList, {
				todoFile: {
					...todoFile,
					items: [
						{
							...todoFile.items[0],
							projects: group === "Projects" ? values : [],
							contexts: group === "Contexts" ? values : [],
						},
					],
				},
				disabled: false,
				onToggleComplete: vi.fn(),
				onDelete: vi.fn(),
			});
			await expect.element(page.getByText(`${prefix}One`, { exact: true })).toBeVisible();
			await expect.element(page.getByText(`${prefix}Two`, { exact: true })).toBeVisible();
			await page.getByRole("button", { name: `2 more ${group}`, exact: true }).hover();
			await expect
				.element(page.getByRole("tooltip"))
				.toHaveTextContent(`${prefix}Three${prefix}Four`);
		}
	);
	it("does not reread the whole Todo file when keyboard focus moves", async () => {
		const readLineNumber = vi.fn((index: number) => index + 1);
		const items = Array.from({ length: 1000 }, (_, index) => ({
			...todoFile.items[0],
			get line_number() {
				return readLineNumber(index);
			},
			description: `Todo item ${index + 1}`,
		}));
		await render(TodoList, {
			todoFile: { ...todoFile, items },
			disabled: false,
			onToggleComplete: vi.fn(),
			onDelete: vi.fn(),
		});
		const first = page.getByRole("checkbox", { name: "Mark Todo item 1 complete", exact: true });
		await expect.element(first).toBeVisible();
		readLineNumber.mockClear();
		(first.element() as HTMLElement).focus();
		await userEvent.keyboard("{Tab}{Tab}");
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Todo item 2 complete", exact: true }))
			.toHaveFocus();
		expect(readLineNumber.mock.calls.length).toBeLessThan(100);
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
		await page.getByRole("button", { name: "Actions for Todo item 1000", exact: true }).click();
		await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
		expect(onDelete).toHaveBeenCalledWith(items[999], expect.any(HTMLButtonElement));
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
		await expect.element(page.getByText("2026-07-11", { exact: true })).toBeVisible();
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Plan complete" }))
			.not.toBeChecked();
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Ship release incomplete" }))
			.toBeChecked();
		await expect
			.element(page.getByRole("button", { name: "Actions for Plan" }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole("button", { name: "Actions for Ship release" }))
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

it("reorders Todo items with the keyboard and submits only on drop", async () => {
	const onReorder = vi.fn();
	render(TodoList, {
		todoFile,
		disabled: false,
		onToggleComplete: vi.fn(),
		onDelete: vi.fn(),
		onReorder,
	});
	const handle = page.getByRole("button", { name: "Reorder Plan", exact: true });
	await expect.element(handle).toBeVisible();
	(handle.element() as HTMLElement).focus();
	await userEvent.keyboard("{Space}{ArrowDown}");
	expect(onReorder).not.toHaveBeenCalled();
	await userEvent.keyboard("{Space}");
	await expect.poll(() => onReorder.mock.calls.length).toBe(1);
	expect(onReorder).toHaveBeenCalledWith([todoFile.items[1], todoFile.items[0]]);
});

it("keyboard reordering reaches offscreen items and returns to bounded rendering after drop", async () => {
	const items = Array.from({ length: 100 }, (_, index) => ({
		...todoFile.items[0],
		line_number: index + 1,
		description: `Item ${index + 1}`,
	}));
	const onReorder = vi.fn();
	render(TodoList, {
		todoFile: { ...todoFile, items },
		disabled: false,
		onToggleComplete: vi.fn(),
		onDelete: vi.fn(),
		onReorder,
	});
	const handle = page.getByRole("button", { name: "Reorder Item 1", exact: true });
	await expect.element(handle).toBeVisible();
	(handle.element() as HTMLElement).focus();
	await userEvent.keyboard("{Space}");
	await userEvent.keyboard("{ArrowDown}".repeat(25));
	await userEvent.keyboard("{Space}");
	await expect.poll(() => onReorder.mock.calls.length).toBe(1);
	expect(onReorder.mock.calls[0][0][25]).toEqual(items[0]);
	await expect
		.poll(() => page.getByRole("list", { name: "Todo items" }).element().children.length)
		.toBeLessThan(30);
});
it("Escape cancels a keyboard reorder without saving", async () => {
	const onReorder = vi.fn();
	render(TodoList, {
		todoFile,
		disabled: false,
		onToggleComplete: vi.fn(),
		onDelete: vi.fn(),
		onReorder,
	});
	const handle = page.getByRole("button", { name: "Reorder Plan", exact: true });
	await expect.element(handle).toBeVisible();
	(handle.element() as HTMLElement).focus();
	await userEvent.keyboard("{Space}{ArrowDown}{Escape}");
	expect(onReorder).not.toHaveBeenCalled();
	await expect.element(page.getByRole("listitem").nth(0)).toMatchTextContent("Plan");
});

it("Escape cancels a keyboard reorder after focus leaves the list", async () => {
	const onReorder = vi.fn();
	render(TodoList, {
		todoFile,
		disabled: false,
		onToggleComplete: vi.fn(),
		onDelete: vi.fn(),
		onReorder,
	});
	const handle = page.getByRole("button", { name: "Reorder Plan", exact: true });
	await expect.element(handle).toBeVisible();
	(handle.element() as HTMLElement).focus();
	await userEvent.keyboard("{Space}{ArrowDown}");
	const outside = document.createElement("button");
	outside.textContent = "Outside the Todo list";
	document.body.append(outside);
	try {
		outside.focus();
		await userEvent.keyboard("{Escape}");
		expect(onReorder).not.toHaveBeenCalled();
		await expect.element(page.getByRole("listitem").nth(0)).toMatchTextContent("Plan");
	} finally {
		outside.remove();
	}
});

it.each(["items", "path", "disabled"] as const)(
	"does not submit a reorder when %s changes during the drag",
	async (change) => {
		const onReorder = vi.fn();
		const props = {
			todoFile,
			disabled: false,
			onToggleComplete: vi.fn(),
			onDelete: vi.fn(),
			onReorder,
		};
		const view = await render(TodoList, props);
		const handle = page.getByRole("button", { name: "Reorder Plan", exact: true });
		await expect.element(handle).toBeVisible();
		(handle.element() as HTMLElement).focus();
		await userEvent.keyboard("{Space}{ArrowDown}");
		await view.rerender({
			...props,
			todoFile: {
				...todoFile,
				items: change === "items" ? [...todoFile.items] : todoFile.items,
				path: change === "path" ? "/tmp/other.todo" : todoFile.path,
			},
			disabled: change === "disabled",
		});
		await userEvent.keyboard("{Space}");
		expect(onReorder).not.toHaveBeenCalled();
		// A disabled drag handle cannot receive a drop command; Escape still cancels globally.
		if (change === "disabled") await userEvent.keyboard("{Escape}");
		await expect.element(page.getByRole("listitem").nth(0)).toMatchTextContent("Plan");
	}
);

it("expands a drag started in the middle without losing unmounted Todo items", async () => {
	const items = Array.from({ length: 100 }, (_, index) => ({
		...todoFile.items[0],
		line_number: index + 1,
		description: `Item ${index + 1}`,
	}));
	const onReorder = vi.fn();
	await render(TodoList, {
		todoFile: { ...todoFile, items },
		disabled: false,
		onToggleComplete: vi.fn(),
		onDelete: vi.fn(),
		onReorder,
	});
	const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
	viewport.scrollTop = 41 * 40;
	const handle = page.getByRole("button", { name: "Reorder Item 45", exact: true });
	await expect.element(handle).toBeVisible();
	await expect.element(page.getByText("Item 1", { exact: true })).not.toBeInTheDocument();
	(handle.element() as HTMLElement).focus();
	await userEvent.keyboard("{Space}");
	await userEvent.keyboard("{ArrowUp}".repeat(25));
	await userEvent.keyboard("{Space}");
	const expected = [...items];
	expected.splice(44, 1);
	expected.splice(19, 0, items[44]);
	await expect.poll(() => onReorder.mock.calls.length).toBe(1);
	expect(onReorder).toHaveBeenCalledWith(expected);
	await expect
		.poll(() => page.getByRole("list", { name: "Todo items" }).element().children.length)
		.toBeLessThan(30);
});

it("row navigation crosses the virtualization window and keeps native controls separate", async () => {
	const items = Array.from({ length: 1000 }, (_, index) => ({
		...todoFile.items[0],
		line_number: index + 1,
		description: `Item ${index + 1}`,
	}));
	const onToggleComplete = vi.fn();
	await render(TodoList, {
		todoFile: { ...todoFile, items },
		disabled: false,
		onToggleComplete,
		onDelete: vi.fn(),
		onReorder: vi.fn(),
	});
	const list = page.getByRole("list", { name: "Todo items" });
	await expect.element(list).toBeVisible();
	(list.element() as HTMLElement).focus();
	await userEvent.keyboard("{ArrowDown}{ArrowUp}");
	await expect
		.element(page.getByRole("button", { name: "Navigate Item 1", exact: true }))
		.toHaveFocus();
	await userEvent.keyboard("{End}{ArrowDown}");
	const last = page.getByRole("button", { name: "Navigate Item 1000", exact: true });
	await expect.element(last).toHaveFocus();
	await expect.element(last).toBeVisible();
	await userEvent.keyboard("{Home}{ArrowDown}");
	const second = page.getByRole("button", { name: "Navigate Item 2", exact: true });
	await expect.element(second).toHaveFocus();
	second
		.element()
		.dispatchEvent(new KeyboardEvent("keydown", { key: " ", repeat: true, bubbles: true }));
	expect(onToggleComplete).not.toHaveBeenCalled();
	await userEvent.keyboard("{Space}");
	expect(onToggleComplete).toHaveBeenCalledTimes(1);
	await userEvent.keyboard("{Tab}");
	await expect
		.element(page.getByRole("button", { name: "Reorder Item 2", exact: true }))
		.toHaveFocus();
	await userEvent.keyboard("{Space}{ArrowDown}{Escape}");
	expect(onToggleComplete).toHaveBeenCalledTimes(1);
});

it("distinguishes only deferred rows and keeps Show from metadata compact on wide lists", async () => {
	try {
		await page.viewport(1800, 700);
		const items: TodoFile["items"] = [
			{ ...todoFile.items[0], description: "Future", metadata: { t: "2026-10-16" } },
			{
				...todoFile.items[0],
				line_number: 2,
				description: "Actionable",
				metadata: { t: "2026-10-14" },
			},
			{ ...todoFile.items[0], line_number: 3, description: "Invalid", metadata: { t: "+2d" } },
			{ ...todoFile.items[1], line_number: 4, metadata: { t: "2026-10-16" } },
		];
		const props = {
			todoFile: { ...todoFile, items },
			today: "2026-10-15",
			disabled: false,
			onToggleComplete: vi.fn(),
			onDelete: vi.fn(),
		};
		const view = await render(TodoList, props);
		await expect.element(page.getByText("Deferred", { exact: true })).toBeVisible();
		const futureRow = page
			.getByRole("button", { name: "Navigate Future", exact: true })
			.element()
			.closest("li")!;
		const actionableRow = page
			.getByRole("button", { name: "Navigate Actionable", exact: true })
			.element()
			.closest("li")!;
		expect(getComputedStyle(futureRow).backgroundColor).not.toBe(
			getComputedStyle(actionableRow).backgroundColor
		);
		const label = page.getByTitle("Show from 2026-10-16 · Deferred", { exact: true }).element();
		expect(label.getBoundingClientRect().width).toBeLessThan(300);
		const menu = page.getByRole("button", { name: "Actions for Future", exact: true }).element();
		expect(menu.getBoundingClientRect().left - label.getBoundingClientRect().right).toBeLessThan(
			40
		);
		await page.viewport(320, 700);
		await expect.element(page.getByText("Deferred", { exact: true })).toBeVisible();
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Future complete", exact: true }))
			.toBeVisible();
		await view.rerender({ ...props, today: "2026-10-16" });
		await expect.element(page.getByText("Deferred", { exact: true })).not.toBeInTheDocument();
		await expect
			.poll(() => getComputedStyle(futureRow).backgroundColor)
			.toBe(getComputedStyle(actionableRow).backgroundColor);
	} finally {
		await page.viewport(800, 600);
	}
});
