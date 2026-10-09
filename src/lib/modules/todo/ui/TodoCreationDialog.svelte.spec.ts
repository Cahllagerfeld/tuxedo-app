import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { TodoFile } from "$lib/modules/todo/domain/todo";
import TodoCreationDialog from "./TodoCreationDialog.svelte";
import type { CreateTodoItemInput, CreateTodoItemResult } from "./todo-creation-types";
import "../../../../routes/layout.css";

const todoFile: TodoFile = {
	path: "/tmp/work.todo",
	items: [
		{
			line_number: 1,
			raw: "Plan release +Work @Office",
			completed: false,
			priority: null,
			creation_date: null,
			completion_date: null,
			description: "Plan release",
			projects: ["Work"],
			contexts: ["Office"],
			metadata: {},
		},
		{
			line_number: 2,
			raw: "x 2026-10-08 Review +Archive @Office",
			completed: true,
			priority: null,
			creation_date: null,
			completion_date: "2026-10-08",
			description: "Review",
			projects: ["Archive"],
			contexts: ["Office"],
			metadata: {},
		},
	],
	skipped: [],
};

function renderDialog(
	createTodoItem: (input: CreateTodoItemInput) => Promise<CreateTodoItemResult>
) {
	return render(TodoCreationDialog, { todoFile, createTodoItem });
}

function openDialog() {
	return page.getByRole("button", { name: "Add Todo item", exact: true }).nth(0).click();
}

function submitDialog() {
	return page.getByRole("button", { name: "Add Todo item", exact: true }).nth(1).click();
}

async function pressEnter(locator: ReturnType<typeof page.getByPlaceholder>) {
	const input = locator.element() as HTMLInputElement;
	input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

test("opens focused, suggests completed-item tags, and preserves typed tag casing", async () => {
	const calls: CreateTodoItemInput[] = [];
	const createTodoItem = async (input: CreateTodoItemInput) => {
		calls.push(input);
		return { status: "applied" as const };
	};
	renderDialog(createTodoItem);
	await openDialog();

	await expect.element(page.getByRole("dialog")).toBeVisible();
	await expect.element(page.getByPlaceholder("What needs doing?")).toHaveFocus();

	const projectInput = page.getByPlaceholder("Choose or create a Project");
	await projectInput.click();
	await expect.element(page.getByRole("option", { name: "Archive" })).toBeVisible();
	await projectInput.fill("+work");
	await expect.element(page.getByRole("option", { name: "Work" })).toBeVisible();
	await projectInput.fill("+typedProject");
	await pressEnter(projectInput);
	await expect.element(page.getByText("+typedProject", { exact: true })).toBeVisible();

	await page.getByPlaceholder("What needs doing?").fill("  Ship   the   release  ");
	await submitDialog();
	await expect.poll(() => calls.length).toBe(1);
	await expect
		.poll(() => calls[0])
		.toEqual({
			description: "Ship the release",
			projects: ["typedProject"],
			contexts: [],
		});
});

test("rejects todo tokens in Description and exact duplicate tags", async () => {
	const calls: CreateTodoItemInput[] = [];
	const createTodoItem = async (input: CreateTodoItemInput) => {
		calls.push(input);
		return { status: "applied" as const };
	};
	renderDialog(createTodoItem);
	await openDialog();

	await page.getByPlaceholder("What needs doing?").fill("Do this +Work key:value");
	await submitDialog();
	await expect
		.element(
			page.getByText("Use the Project and Context inputs for tags. Metadata is not supported here.")
		)
		.toBeVisible();
	await expect.poll(() => calls.length).toBe(0);

	const projectInput = page.getByPlaceholder("Choose or create a Project");
	await projectInput.fill("Work");
	await pressEnter(projectInput);
	await expect.element(page.getByText("+Work", { exact: true })).toBeVisible();
	await projectInput.fill("Work");
	await pressEnter(projectInput);
	await expect.element(page.getByText("That tag is already selected.")).toBeVisible();
});

test("retains the draft on conflicts and resets it on cancel", async () => {
	const createTodoItem = async () => ({
		status: "conflict" as const,
		message: "changed",
	});
	renderDialog(createTodoItem);
	await openDialog();
	const description = page.getByPlaceholder("What needs doing?");
	await description.fill("Keep this draft");
	await submitDialog();
	await expect.element(page.getByRole("dialog")).toBeVisible();
	await expect.element(description).toHaveValue("Keep this draft");

	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await openDialog();
	await expect.element(page.getByPlaceholder("What needs doing?")).toHaveValue("");
});
