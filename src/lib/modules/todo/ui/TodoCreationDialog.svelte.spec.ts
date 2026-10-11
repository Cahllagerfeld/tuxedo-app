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

const crowdedTodoFile: TodoFile = {
	...todoFile,
	items: [
		...todoFile.items,
		...Array.from({ length: 12 }, (_, index) => ({
			line_number: index + 3,
			raw: `Item ${index} @Context${index}`,
			completed: false,
			priority: null,
			creation_date: null,
			completion_date: null,
			description: `Item ${index}`,
			projects: [],
			contexts: [`Context${index}`],
			metadata: {},
		})),
	],
};

function renderDialog(
	createTodoItem: (input: CreateTodoItemInput) => Promise<CreateTodoItemResult>,
	file = todoFile
) {
	return render(TodoCreationDialog, { todoFile: file, createTodoItem });
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
	const description = page.getByPlaceholder("What needs doing?").element();
	const viewport = description.closest(".overflow-y-auto")!;
	const inputBounds = description.getBoundingClientRect();
	const viewportBounds = viewport.getBoundingClientRect();
	expect(inputBounds.left - viewportBounds.left).toBeGreaterThanOrEqual(3);
	expect(viewportBounds.right - inputBounds.right).toBeGreaterThanOrEqual(3);

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
			priority: null,
			creationDate: expect.any(String),
			completed: false,
			completionDate: null,
			metadata: [],
		});
});

test("keeps the bottom tag suggestion hit-testable inside the modal", async () => {
	const createTodoItem = async () => ({ status: "applied" as const });
	renderDialog(createTodoItem, crowdedTodoFile);
	await openDialog();

	const contextInput = page.getByPlaceholder("Choose or create a Context");
	await contextInput.click();
	const input = contextInput.element() as HTMLInputElement;
	for (let index = 0; index < 12; index += 1) {
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	await expect
		.poll(
			() =>
				document.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.textContent
		)
		.toBe("Context9");

	const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
	const bottomOption = options.find((option) => option.textContent === "Context9");
	expect(bottomOption).toBeDefined();
	const bounds = bottomOption!.getBoundingClientRect();
	const hit = document.elementFromPoint(
		bounds.left + bounds.width / 2,
		bounds.top + bounds.height / 2
	);
	expect(hit === bottomOption || hit?.closest('[role="option"]') === bottomOption).toBe(true);
	await page.getByRole("option", { name: "Context9" }).click();
	await expect.element(page.getByText("@Context9", { exact: true })).toBeVisible();
});

test.each(["Do this +Work key:value", "Call\u0085+Work"])(
	"rejects Todo tokens in Description (%s) and invalid tags",
	async (description) => {
		const calls: CreateTodoItemInput[] = [];
		const createTodoItem = async (input: CreateTodoItemInput) => {
			calls.push(input);
			return { status: "applied" as const };
		};
		renderDialog(createTodoItem);
		await openDialog();

		await page.getByPlaceholder("What needs doing?").fill(description);
		await submitDialog();
		await expect
			.element(page.getByText("Use the Project, Context, and Metadata inputs for these tokens."))
			.toBeVisible();
		await expect.poll(() => calls.length).toBe(0);

		const projectInput = page.getByPlaceholder("Choose or create a Project");
		await projectInput.fill("Work");
		await pressEnter(projectInput);
		await expect.element(page.getByText("+Work", { exact: true })).toBeVisible();
		await projectInput.fill("Work");
		await pressEnter(projectInput);
		await expect.element(page.getByText("That tag is already selected.")).toBeVisible();
		await projectInput.fill("at\u0085home");
		await pressEnter(projectInput);
		await expect.element(page.getByText("Use a tag name without spaces.")).toBeVisible();
	}
);

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

test("retains spaces while editing Description and normalizes them only on submission", async () => {
	const calls: CreateTodoItemInput[] = [];
	renderDialog(async (input) => {
		calls.push(input);
		return { status: "applied" };
	});
	await openDialog();
	const description = page.getByPlaceholder("What needs doing?");
	await description.fill("Buy ");
	// Let reactive validation finish before typing the next word.
	await new Promise((resolve) => setTimeout(resolve, 50));
	await expect.element(description).toHaveValue("Buy ");
	await description.fill("Buy  groceries ");
	await new Promise((resolve) => setTimeout(resolve, 50));
	await expect.element(description).toHaveValue("Buy  groceries ");
	await submitDialog();
	await expect
		.poll(() => calls)
		.toEqual([
			{
				description: "Buy groceries",
				projects: [],
				contexts: [],
				priority: null,
				creationDate: expect.any(String),
				completed: false,
				completionDate: null,
				metadata: [],
			},
		]);
});

test("submits optional Priority, Creation date, and custom Metadata for an open Todo item", async () => {
	const calls: CreateTodoItemInput[] = [];
	renderDialog(async (input) => {
		calls.push(input);
		return { status: "applied" };
	});
	await openDialog();
	await page.getByRole("button", { name: "Priority (optional)" }).click();
	await page.getByRole("option", { name: "(Z)", exact: true }).click();
	await page.getByRole("button", { name: "Creation date (optional)" }).click();
	const monthsFromOctober = (new Date().getFullYear() - 2026) * 12 + new Date().getMonth() - 9;
	for (let month = 0; month < Math.abs(monthsFromOctober); month++) {
		await page
			.getByRole("button", { name: monthsFromOctober > 0 ? "Previous" : "Next", exact: true })
			.click();
	}
	await expect
		.element(page.getByRole("combobox", { name: "Select a month" }))
		.not.toBeInTheDocument();
	await page.getByRole("button", { name: /Thursday, October 1, 2026/ }).click();
	await page.getByRole("button", { name: "Creation date (optional)" }).click();
	const metadata = page.getByPlaceholder("Add key:value");
	await metadata.fill("due:2026-10-10");
	await pressEnter(metadata);
	await metadata.fill("custom:value");
	await pressEnter(metadata);
	await submitDialog();
	await expect
		.poll(() => calls)
		.toEqual([
			{
				description: "",
				projects: [],
				contexts: [],
				priority: "Z",
				creationDate: "2026-10-01",
				completed: false,
				completionDate: null,
				metadata: ["due:2026-10-10", "custom:value"],
			},
		]);
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	await openDialog();
	await expect
		.element(page.getByRole("checkbox", { name: "Completed", exact: true }))
		.not.toBeInTheDocument();
	await expect
		.element(page.getByRole("button", { name: "Priority (optional)" }))
		.toHaveTextContent("None");
	await expect.element(page.getByText("custom:value", { exact: true })).not.toBeInTheDocument();
});

test("validates Metadata inline and retains structured drafts on failure", async () => {
	let calls = 0;
	renderDialog(async () => {
		calls++;
		return { status: "rejected", message: "Cannot write" };
	});
	await openDialog();
	const metadata = page.getByPlaceholder("Add key:value");
	await metadata.fill("key:too:many");
	await pressEnter(metadata);
	await expect
		.element(page.getByText("Use key:value without spaces or extra colons."))
		.toBeVisible();
	await metadata.fill("custom:value");
	await pressEnter(metadata);
	await metadata.fill("custom:another");
	await pressEnter(metadata);
	await expect.element(page.getByText("custom:another", { exact: true })).toBeVisible();
	await metadata.fill("");
	await submitDialog();
	await expect.poll(() => calls).toBe(1);
	await expect.element(page.getByRole("dialog")).toBeVisible();
	await expect.element(page.getByText("custom:value", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await openDialog();
	await expect
		.element(page.getByRole("checkbox", { name: "Completed", exact: true }))
		.not.toBeInTheDocument();
	await expect.element(page.getByText("custom:value", { exact: true })).not.toBeInTheDocument();
});

test("preserves leading prefix characters in existing Project suggestions", async () => {
	const calls: CreateTodoItemInput[] = [];
	renderDialog(
		async (input) => {
			calls.push(input);
			return { status: "applied" };
		},
		{ ...todoFile, items: [{ ...todoFile.items[0], projects: ["+Work"] }] }
	);
	await openDialog();
	await page.getByPlaceholder("Choose or create a Project").click();
	await page.getByRole("option", { name: "+Work", exact: true }).click();
	await submitDialog();
	await expect.poll(() => calls[0]?.projects).toEqual(["+Work"]);
});

test("allows identical Metadata tokens and removes the selected occurrence", async () => {
	const calls: CreateTodoItemInput[] = [];
	renderDialog(async (input) => {
		calls.push(input);
		return { status: "applied" };
	});
	await openDialog();
	const metadata = page.getByPlaceholder("Add key:value");
	for (const value of ["custom:first", "custom:middle", "custom:first"]) {
		await metadata.fill(value);
		await pressEnter(metadata);
	}
	await expect
		.element(page.getByRole("button", { name: "Remove custom:first", exact: true }).nth(1))
		.toBeVisible();
	await page.getByRole("button", { name: "Remove custom:first", exact: true }).nth(1).click();
	await submitDialog();
	await expect.poll(() => calls[0]?.metadata).toEqual(["custom:first", "custom:middle"]);
});

test("includes typed Metadata when submitting without pressing Enter", async () => {
	const calls: CreateTodoItemInput[] = [];
	renderDialog(async (input) => {
		calls.push(input);
		return { status: "applied" };
	});
	await openDialog();
	await page.getByPlaceholder("What needs doing?").fill("Plan release");
	await page.getByPlaceholder("Add key:value").fill("due:2026-10-12");
	await submitDialog();
	await expect.poll(() => calls[0]?.metadata).toEqual(["due:2026-10-12"]);
});

test("rejects invalid typed Metadata on submit and keeps it for correction", async () => {
	const calls: CreateTodoItemInput[] = [];
	renderDialog(async (input) => {
		calls.push(input);
		return { status: "applied" };
	});
	await openDialog();
	const metadata = page.getByPlaceholder("Add key:value");
	await metadata.fill("bad:too:many");
	await submitDialog();
	await expect
		.element(page.getByText("Use key:value without spaces or extra colons."))
		.toBeVisible();
	expect(calls).toHaveLength(0);
	await expect.element(metadata).toHaveValue("bad:too:many");
	await metadata.fill("custom:value");
	await submitDialog();
	await expect.poll(() => calls[0]?.metadata).toEqual(["custom:value"]);
});

test("retains committed and pending Metadata after a failed save without duplicating it", async () => {
	const calls: CreateTodoItemInput[] = [];
	renderDialog(async (input) => {
		calls.push(input);
		return { status: "rejected", message: "Cannot write" };
	});
	await openDialog();
	const metadata = page.getByPlaceholder("Add key:value");
	await metadata.fill("custom:first");
	await pressEnter(metadata);
	await metadata.fill("custom:last");
	await submitDialog();
	await expect.poll(() => calls.length).toBe(1);
	await expect.element(page.getByText("custom:last", { exact: true })).toBeVisible();
	await expect.element(metadata).toHaveValue("");
	await submitDialog();
	await expect.poll(() => calls.length).toBe(2);
	expect(calls.map((input) => input.metadata)).toEqual([
		["custom:first", "custom:last"],
		["custom:first", "custom:last"],
	]);
});
