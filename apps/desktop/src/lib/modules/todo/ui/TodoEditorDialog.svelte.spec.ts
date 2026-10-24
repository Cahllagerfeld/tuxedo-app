import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { TodoFile } from "#lib/modules/todo/domain/todo.js";
import TodoEditorDialog from "./TodoEditorDialog.svelte";
import type { TodoItemDraft, SaveTodoItemResult } from "./todo-editor-types";
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

			edit: { description: "Plan release", metadata: [] },
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

			edit: { description: "Review", metadata: [] },
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

			edit: { description: `Item ${index}`, metadata: [] },
		})),
	],
};

function renderDialog(
	saveTodoItem: (input: TodoItemDraft) => Promise<SaveTodoItemResult>,
	file = todoFile
) {
	return render(TodoEditorDialog, { todoFile: file, saveTodoItem });
}

function openDialog() {
	return page.getByRole("button", { name: "Add Todo item", exact: true }).nth(0).click();
}

test("creation keeps the primary action visible at desktop and narrow window sizes", async () => {
	renderDialog(async () => ({ status: "applied" }));
	const trigger = page.getByRole("button", { name: "Add Todo item", exact: true });
	await expect.element(trigger).toHaveTextContent("");
	await page.viewport(1280, 800);
	await openDialog();
	await expect.element(page.getByPlaceholder("What needs doing?")).toHaveFocus();
	for (const [width, height] of [
		[1280, 800],
		[420, 700],
	]) {
		await page.viewport(width, height);
		const dialog = page.getByRole("dialog").element();
		const submit = page
			.getByRole("button", { name: "Add Todo item", exact: true })
			.nth(1)
			.element();
		expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
		expect(submit.getBoundingClientRect().bottom).toBeLessThanOrEqual(height);
	}
	await page.viewport(1280, 800);
	await page.getByRole("button", { name: "Clear Creation date", exact: true }).click();
	await expect
		.element(page.getByRole("button", { name: "Creation date", exact: true }))
		.toHaveFocus();
});

test("Due date controls edit the same metadata and preserve malformed values until explicitly changed", async () => {
	const calls: TodoItemDraft[] = [];
	const item = {
		...todoFile.items[0],
		metadata: { due: "tomorrow", custom: "keep" },
		edit: { description: "Plan release", metadata: ["due:tomorrow", "custom:keep"] },
	};
	render(TodoEditorDialog, {
		todoFile,
		todoToEdit: item,
		saveTodoItem: async (input) => {
			calls.push(input);
			return { status: "rejected", message: "Retry" };
		},
	});
	await expect.element(page.getByRole("button", { name: "Due date", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect.poll(() => calls[0]?.metadata).toEqual(["due:tomorrow", "custom:keep"]);
	await page.getByRole("button", { name: "Remove due:tomorrow", exact: true }).click();
	await page.getByPlaceholder("Add key:value").fill("due:2026-10-14");
	await userEvent.keyboard("{Enter}");
	const picker = page.getByRole("button", { name: "Due date", exact: true });
	await expect.element(picker).toHaveTextContent("October 14, 2026");
	await picker.click();
	await page.getByRole("button", { name: /Thursday, October 15, 2026/ }).click();
	await picker.click();
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect.poll(() => calls[1]?.metadata).toEqual(["custom:keep", "due:2026-10-15"]);
	await page.getByRole("button", { name: "Clear Due date", exact: true }).click();
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect.poll(() => calls[2]?.metadata).toEqual(["custom:keep"]);
});

test("Show from preserves unsupported and repeated metadata until the calendar changes or clears it", async () => {
	const calls: TodoItemDraft[] = [];
	render(TodoEditorDialog, {
		todoFile,
		todoToEdit: {
			...todoFile.items[0],
			metadata: { t: "+2d" },
			edit: { description: "Plan release", metadata: ["t:2026-10-01", "t:+2d", "custom:keep"] },
		},
		saveTodoItem: async (input) => {
			calls.push(input);
			return { status: "rejected", message: "Retry" };
		},
	});
	const picker = page.getByRole("button", { name: "Show from", exact: true });
	await expect.element(picker).toHaveTextContent("Pick a date");
	await expect
		.element(
			page.getByText(
				"Unsupported Show from value: +2d. Kept in Metadata until changed or cleared.",
				{ exact: true }
			)
		)
		.toBeVisible();
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect.poll(() => calls[0]?.metadata).toEqual(["t:2026-10-01", "t:+2d", "custom:keep"]);
	await page.getByRole("button", { name: "Remove t:+2d", exact: true }).click();
	await page.getByPlaceholder("Add key:value").fill("t:2026-10-14");
	await userEvent.keyboard("{Enter}");
	await expect.element(picker).toHaveTextContent("October 14, 2026");
	await picker.click();
	await page.getByRole("button", { name: /Thursday, October 15, 2026/ }).click();
	await picker.click();
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect.poll(() => calls[1]?.metadata).toEqual(["custom:keep", "t:2026-10-15"]);
	await expect.element(picker).toHaveTextContent("October 15, 2026");
	await page.getByRole("button", { name: "Clear Show from", exact: true }).click();
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect.poll(() => calls[2]?.metadata).toEqual(["custom:keep"]);
});

test("editing retains the Todo item's tags instead of creation defaults", async () => {
	let saved: TodoItemDraft | undefined;
	render(TodoEditorDialog, {
		todoFile,
		todoToEdit: todoFile.items[0],
		initialProject: "Personal",
		initialContext: "Home",
		saveTodoItem: async (input) => {
			saved = input;
			return { status: "applied" };
		},
	});
	await expect
		.element(page.getByRole("button", { name: "Remove +Work", exact: true }))
		.toBeVisible();
	await expect
		.element(page.getByRole("button", { name: "Remove @Office", exact: true }))
		.toBeVisible();
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect.poll(() => saved).toMatchObject({ projects: ["Work"], contexts: ["Office"] });
});

function submitDialog() {
	return page.getByRole("button", { name: "Add Todo item", exact: true }).nth(1).click();
}

test("submission commits typed Projects and Contexts without Enter", async () => {
	let saved: TodoItemDraft | undefined;
	renderDialog(async (input) => {
		saved = input;
		return { status: "applied" };
	});
	await openDialog();
	await page.getByPlaceholder("What needs doing?").fill("Ship release");
	await page.getByPlaceholder("Choose or create a Project").fill("+Release");
	await page.getByPlaceholder("Choose or create a Context").fill("@Office");
	await submitDialog();
	await expect.poll(() => saved).toMatchObject({ projects: ["Release"], contexts: ["Office"] });
});

test.each(["Project", "Context"])(
	"invalid typed %s blocks submission until corrected",
	async (field) => {
		let saved: TodoItemDraft | undefined;
		renderDialog(async (input) => {
			saved = input;
			return { status: "applied" };
		});
		await openDialog();
		await page.getByPlaceholder("What needs doing?").fill("Ship release");
		const input = page.getByPlaceholder(`Choose or create a ${field}`);
		await input.fill("two words");
		await submitDialog();
		await expect.element(page.getByText("Use a tag name without spaces.")).toBeVisible();
		expect(saved).toBeUndefined();
		await expect.element(input).toHaveValue("two words");
		await input.fill("Release");
		await submitDialog();
		await expect
			.poll(() => saved)
			.toMatchObject(field === "Project" ? { projects: ["Release"] } : { contexts: ["Release"] });
	}
);

async function pressEnter(locator: ReturnType<typeof page.getByPlaceholder>) {
	const input = locator.element() as HTMLInputElement;
	input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

test("opens focused, suggests completed-item tags, and preserves typed tag casing", async () => {
	const calls: TodoItemDraft[] = [];
	const saveTodoItem = async (input: TodoItemDraft) => {
		calls.push(input);
		return { status: "applied" as const };
	};
	renderDialog(saveTodoItem);
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
	const saveTodoItem = async () => ({ status: "applied" as const });
	renderDialog(saveTodoItem, crowdedTodoFile);
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
		const calls: TodoItemDraft[] = [];
		const saveTodoItem = async (input: TodoItemDraft) => {
			calls.push(input);
			return { status: "applied" as const };
		};
		renderDialog(saveTodoItem);
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
		await page.getByRole("button", { name: "Remove +Work", exact: true }).click();
		await expect.element(page.getByText("Use a tag name without spaces.")).not.toBeInTheDocument();
	}
);

test("retains the draft on conflicts and resets it on cancel", async () => {
	const saveTodoItem = async () => ({
		status: "conflict" as const,
		message: "changed",
	});
	renderDialog(saveTodoItem);
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
	const calls: TodoItemDraft[] = [];
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
	const calls: TodoItemDraft[] = [];
	renderDialog(async (input) => {
		calls.push(input);
		return { status: "applied" };
	});
	await openDialog();
	await page.getByRole("button", { name: "Other", exact: true }).click();
	await page.getByRole("textbox", { name: "Other priority" }).fill("z");
	await page.getByRole("button", { name: "Creation date", exact: true }).click();
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
	await page.getByRole("button", { name: "Creation date", exact: true }).click();
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
		.element(page.getByRole("button", { name: "None", exact: true }))
		.toHaveAttribute("aria-pressed", "true");
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
	const calls: TodoItemDraft[] = [];
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
	const calls: TodoItemDraft[] = [];
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
	const calls: TodoItemDraft[] = [];
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
	const calls: TodoItemDraft[] = [];
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
	const calls: TodoItemDraft[] = [];
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

test.each(["None", "A", "B", "C"])(
	"creates a Todo item with the %s priority button",
	async (priority) => {
		const calls: TodoItemDraft[] = [];
		renderDialog(async (input) => {
			calls.push(input);
			return { status: "applied" };
		});
		await openDialog();
		const button = page.getByRole("button", { name: priority, exact: true });
		await button.click();
		await expect.element(button).toHaveAttribute("aria-pressed", "true");
		await expect
			.element(page.getByRole("textbox", { name: "Other priority" }))
			.not.toBeInTheDocument();
		await submitDialog();
		await expect.poll(() => calls[0]?.priority).toBe(priority === "None" ? null : priority);
	}
);

test("validates Other priorities and resets its input when choosing a common priority", async () => {
	const calls: TodoItemDraft[] = [];
	renderDialog(async (input) => {
		calls.push(input);
		return { status: "applied" };
	});
	await openDialog();
	await page.getByRole("button", { name: "Other", exact: true }).click();
	const input = page.getByRole("textbox", { name: "Other priority" });
	await expect.element(input).toHaveFocus();
	await submitDialog();
	await expect
		.element(page.getByText("Choose None, A, B, C, or enter one letter from D to Z."))
		.toBeVisible();
	expect(calls).toHaveLength(0);
	await input.fill("9");
	await submitDialog();
	expect(calls).toHaveLength(0);
	await input.fill("A");
	await submitDialog();
	expect(calls).toHaveLength(0);
	await input.fill("d");
	await expect.element(input).toHaveValue("D");
	await page.getByRole("button", { name: "B", exact: true }).click();
	await expect.element(input).not.toBeInTheDocument();
	await page.getByRole("button", { name: "Other", exact: true }).click();
	await expect.element(input).toHaveValue("");
	await page.getByRole("button", { name: "None", exact: true }).click();
	await submitDialog();
	await expect.poll(() => calls[0]?.priority).toBe(null);
	await openDialog();
	await expect
		.element(page.getByRole("button", { name: "None", exact: true }))
		.toHaveAttribute("aria-pressed", "true");
	await expect.element(input).not.toBeInTheDocument();
});

test.each(["+2d", "2026-02-30"])(
	"Show from retains unsupported %s on cancellation",
	async (value) => {
		const calls: TodoItemDraft[] = [];
		render(TodoEditorDialog, {
			todoFile,
			todoToEdit: {
				...todoFile.items[0],
				edit: { description: "Plan release", metadata: [`t:${value}`] },
			},
			saveTodoItem: async (input) => {
				calls.push(input);
				return { status: "applied" };
			},
		});
		await expect
			.element(page.getByRole("button", { name: "Show from", exact: true }))
			.toHaveTextContent("Pick a date");
		await expect
			.element(
				page.getByText(
					`Unsupported Show from value: ${value}. Kept in Metadata until changed or cleared.`,
					{ exact: true }
				)
			)
			.toBeVisible();
		await page.getByRole("button", { name: "Clear Show from", exact: true }).click();
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		expect(calls).toEqual([]);
	}
);

test("creation starts without Show from and warns without blocking a threshold after Due date", async () => {
	const calls: TodoItemDraft[] = [];
	renderDialog(async (input) => {
		calls.push(input);
		return { status: "applied" };
	});
	await openDialog();
	await expect
		.element(page.getByRole("button", { name: "Show from", exact: true }))
		.toHaveTextContent("Pick a date");
	const metadata = page.getByPlaceholder("Add key:value");
	await metadata.fill("due:2026-10-01");
	await userEvent.keyboard("{Enter}");
	await metadata.fill("t:2026-10-14");
	await userEvent.keyboard("{Enter}");
	await expect
		.element(
			page.getByText(
				"Show from is after Due date. This Todo item will stay deferred past its deadline.",
				{ exact: true }
			)
		)
		.toBeVisible();
	await submitDialog();
	await expect.poll(() => calls[0]?.metadata).toEqual(["due:2026-10-01", "t:2026-10-14"]);
	await openDialog();
	await expect
		.element(page.getByRole("button", { name: "Show from", exact: true }))
		.toHaveTextContent("Pick a date");
});
