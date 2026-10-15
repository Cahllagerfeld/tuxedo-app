import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { TodoItem } from "../domain/todo";
import TodoDetails from "./TodoDetails.svelte";
import TodoRow from "./TodoItem.svelte";
import "../../../../routes/layout.css";

const todo: TodoItem = {
	line_number: 1,
	raw: "Clean rec:1w",
	description: "Clean",
	completed: false,
	priority: null,
	creation_date: null,
	completion_date: null,
	projects: [],
	contexts: [],
	metadata: { rec: "1w" },
	edit: { description: "Clean", metadata: ["rec:1w"] },
};

it.each([
	["1d", "1 day"],
	["1w", "1 week"],
	["2w", "2 weeks"],
	["3m", "3 months"],
	["1y", "1 year"],
])("shows %s as a dedicated Recurrence field", async (rec, label) => {
	render(TodoDetails, {
		todo: { ...todo, metadata: { rec, due: "2026-10-20", custom: "value" } },
		path: "/tmp/todo.txt",
		disabled: false,
		onClose: vi.fn(),
		onEdit: vi.fn(),
		onToggleComplete: vi.fn(),
		onDelete: vi.fn(),
	});
	await expect.element(page.getByText("Recurrence", { exact: true })).toBeVisible();
	await expect.element(page.getByText(label, { exact: true })).toBeVisible();
	await expect.element(page.getByText("rec", { exact: true })).not.toBeInTheDocument();
	await expect.element(page.getByText("Due", { exact: true })).toBeVisible();
	await expect.element(page.getByText("custom", { exact: true })).toBeVisible();
});

it.each([false, true])("labels recurring rows when completed is %s", async (completed) => {
	render(TodoRow, {
		todo: { ...todo, completed },
		today: "2026-10-15",
		disabled: false,
		onToggleComplete: vi.fn(),
		onDelete: vi.fn(),
	});
	await expect.element(page.getByTitle("Recurrence: 1 week")).toBeVisible();
	await expect.element(page.getByText("Recurring", { exact: true })).toBeInTheDocument();
});

it.each([undefined, "+1w", "0d", "1W"])(
	"does not label unsupported or absent recurrence %s as recurring",
	async (rec) => {
		render(TodoRow, {
			todo: { ...todo, metadata: rec === undefined ? {} : { rec } },
			today: "2026-10-15",
			disabled: false,
			onToggleComplete: vi.fn(),
			onDelete: vi.fn(),
		});
		await expect.element(page.getByText("Recurring", { exact: true })).not.toBeInTheDocument();
	}
);

it("keeps unsupported recurrence visible for repair in details", async () => {
	render(TodoDetails, {
		todo: { ...todo, metadata: { rec: "+1w" } },
		path: "/tmp/todo.txt",
		disabled: false,
		onClose: vi.fn(),
		onEdit: vi.fn(),
		onToggleComplete: vi.fn(),
		onDelete: vi.fn(),
	});
	await expect.element(page.getByText("Unsupported recurrence", { exact: true })).toBeVisible();
	expect(
		page.getByText("Unsupported recurrence", { exact: true }).element().parentElement?.textContent
	).toContain("+1w");
});
