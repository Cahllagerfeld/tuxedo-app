import { page, userEvent } from "vitest/browser";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import type {
	ConfirmedSession,
	DesktopAPI,
	TodoFile,
	TodoFileChange,
} from "$lib/shared/desktop/contract";
import Harness from "./WorkspaceContentHarness.svelte";
import "../../../../routes/layout.css";
const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const todo: TodoFile["items"][number] = {
	line_number: 1,
	raw: "Plan release +Work",
	completed: false,
	priority: null,
	creation_date: null,
	completion_date: null,
	description: "Plan release",
	projects: ["Work"],
	contexts: [],
	metadata: {},
};
const initial: ConfirmedSession = {
	scope,
	revision: 1,
	session: {
		status: "ready",
		catalogue: {
			version: 1,
			active_workspace_id: workspaceId,
			workspaces: [
				{
					id: workspaceId,
					name: "Work",
					color: "blue",
					todo_path: "/tmp/work.todo",
					created_at: "2026-07-10T10:00:00Z",
				},
			],
		},
		todo_file: { path: "/tmp/work.todo", items: [todo], skipped: [] },
	},
};
function adapter(overrides: Partial<DesktopAPI> = {}): DesktopAPI {
	return {
		readSession: async () => initial,
		restoreSession: async () => initial,
		selectTodoFile: async () => null,
		createWorkspace: async () => ({ status: "rejected", message: "unused" }),
		switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
		deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
		setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
		deleteTodo: async () => ({ status: "rejected", message: "unused" }),
		reorderTodo: async () => ({ status: "rejected", message: "unused" }),
		createTodo: async () => ({ status: "rejected", message: "unused" }),
		...overrides,
	};
}
function confirmedTodo(items: TodoFile["items"]) {
	return {
		scope,
		revision: 2,
		workspaceId,
		todo_file: { path: "/tmp/work.todo", items, skipped: [] },
	};
}
test("idle observation updates the list, counts, facets, and skipped lines with one info notice", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const refreshed: ConfirmedSession = {
		...initial,
		revision: 2,
		session: {
			...initial.session,
			todo_file: {
				path: "/tmp/work.todo",
				items: [
					{
						...todo,
						raw: "(B) New item +Home @desk",
						description: "New item",
						priority: "B",
						projects: ["Home"],
						contexts: ["desk"],
					},
					{
						...todo,
						line_number: 2,
						raw: "x Finished",
						description: "Finished",
						completed: true,
						projects: [],
					},
				],
				skipped: [{ line_number: 3, raw: "x", reason: "Missing description" }],
			},
		},
	};
	let loads = 0;
	let notify!: (event: TodoFileChange) => void;
	render(Harness, {
		desktop: adapter({ restoreSession: async () => (loads++ ? refreshed : initial) }),
		observation: {
			onTodoFileChanged(listener) {
				notify = listener;
				return () => {};
			},
		},
	});
	await expect.element(page.getByText("Plan release", { exact: true })).toBeVisible();
	notify({ scope, revision: 1, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.element(page.getByText("New item", { exact: true })).toBeVisible();
	await expect.element(page.getByText("Plan release", { exact: true })).not.toBeInTheDocument();
	await expect.element(page.getByLabelText("Summary counts")).toHaveTextContent("1/1/1");
	await expect.element(page.getByLabelText("Summary facets")).toHaveTextContent("Home");
	await expect.element(page.getByLabelText("Reader status")).toMatchTextContent("1 skipped line");
	await expect
		.poll(() => document.querySelectorAll('[data-sonner-toast][data-type="info"]').length)
		.toBe(1);
	expect(document.querySelectorAll('[data-sonner-toast][data-type="error"]').length).toBe(0);
});

test("conflict recovery and delayed observation never stack error and info notices", async () => {
	let notify!: (event: TodoFileChange) => void;
	const latest = confirmedTodo([{ ...todo, raw: "Edited", description: "Edited" }]);
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const refreshed: ConfirmedSession = {
		...initial,
		revision: 3,
		session: { ...initial.session, todo_file: latest.todo_file },
	};
	let loads = 0;
	render(Harness, {
		desktop: adapter({
			restoreSession: async () => (loads++ ? refreshed : initial),
			setTodoCompletion: async () => {
				notify({ scope, revision: 1, workspaceId, todoPath: "/tmp/work.todo" });
				return { status: "conflict", message: "changed", confirmed: latest };
			},
		}),
		observation: {
			onTodoFileChanged(listener) {
				notify = listener;
				return () => {};
			},
		},
	});
	await page.getByRole("checkbox", { name: "Mark Plan release complete" }).click();
	await expect.element(page.getByText("Edited", { exact: true })).toBeVisible();
	notify({ scope, revision: 2, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.poll(() => loads).toBe(2);
	await expect
		.element(page.getByText("Todo file changed externally; reloaded latest version"))
		.toBeVisible();
	expect(document.querySelectorAll('[data-sonner-toast][data-type="info"]').length).toBe(0);
	expect(document.querySelectorAll('[data-sonner-toast][data-type="error"]').length).toBe(1);
});
test("loading is a non-actionable Workspace session", async () => {
	render(Harness, { desktop: adapter({ restoreSession: () => new Promise(() => {}) }) });
	await expect.element(page.getByLabelText("Loading workspace session")).toBeVisible();
	await expect.element(page.getByRole("button")).not.toBeInTheDocument();
});
test("accepted completion removes the item from the default Open view", async () => {
	let finish!: (result: Awaited<ReturnType<DesktopAPI["setTodoCompletion"]>>) => void;
	render(Harness, {
		desktop: adapter({
			setTodoCompletion: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		}),
	});
	const checkbox = page.getByRole("checkbox", { name: "Mark Plan release complete" });
	await expect.element(checkbox).toBeVisible();
	const originalCheckbox = document.querySelector('[role="checkbox"]');
	const list = document.querySelector('ul[aria-label="Todo items"]')!;
	const initialTop = list.getBoundingClientRect().top;
	await checkbox.click();
	await expect.element(checkbox).toBeDisabled();
	await expect.element(checkbox).not.toBeChecked();
	await expect.element(page.getByText("Updating Todo file…")).toBeVisible();
	const pendingTop = list.getBoundingClientRect().top;
	await expect.element(page.getByLabelText("Summary counts")).toHaveTextContent("1/0/1");
	finish({
		status: "applied",
		confirmed: confirmedTodo([
			{
				...todo,
				completed: true,
				raw: "x 2026-07-18 Plan release +Work",
				completion_date: "2026-07-18",
			},
		]),
	});
	await expect
		.element(page.getByRole("checkbox", { name: "Mark Plan release incomplete" }))
		.not.toBeInTheDocument();
	await expect.element(page.getByLabelText("Summary counts")).toHaveTextContent("0/1/1");
	expect({
		pendingShift: pendingTop - initialTop,
		confirmedShift: 0,
		sameCheckbox: document.querySelector('[role="checkbox"]') === originalCheckbox,
	}).toEqual({ pendingShift: 0, confirmedShift: 0, sameCheckbox: false });
});
test("conflicts display current confirmed content and an external edit notice", async () => {
	render(Harness, {
		desktop: adapter({
			setTodoCompletion: async () => ({
				status: "conflict",
				message: "changed",
				confirmed: confirmedTodo([
					{
						...todo,
						raw: "Plan release carefully",
						description: "Plan release carefully",
						projects: [],
					},
				]),
			}),
		}),
	});
	await page.getByRole("checkbox", { name: "Mark Plan release complete" }).click();
	await expect.element(page.getByText("Plan release carefully")).toBeVisible();
	await expect
		.element(page.getByText("Todo file changed externally; reloaded latest version"))
		.toBeVisible();
	await expect.element(page.getByLabelText("Summary facets")).toHaveTextContent("");
});
test("rejected deletion preserves confirmed content and reports its contextual error", async () => {
	render(Harness, {
		desktop: adapter({
			deleteTodo: async () => ({ status: "rejected", message: "permission denied" }),
		}),
	});
	await page.getByRole("button", { name: "Delete Plan release" }).click();
	await expect.element(page.getByText("Plan release", { exact: true })).toBeVisible();
	await expect.element(page.getByText("Could not delete Todo item")).toBeVisible();
	await expect.element(page.getByText("permission denied")).toBeVisible();
});
test("an unavailable catalogue offers no actions", async () => {
	render(Harness, {
		desktop: adapter({
			restoreSession: async () => ({
				scope,
				revision: 1,
				session: { status: "unavailable", error: "invalid catalogue" },
			}),
		}),
	});
	await expect.element(page.getByRole("alert")).toMatchTextContent("invalid catalogue");
	await expect.element(page.getByRole("button")).not.toBeInTheDocument();
});
test("Empty state retains restoration warnings", async () => {
	if (initial.session.status !== "ready") throw Error("No initial file");
	const catalogue = initial.session.catalogue;
	render(Harness, {
		desktop: adapter({
			restoreSession: async () => ({
				scope,
				revision: 1,
				session: { status: "empty", catalogue, warning: "Could not open /tmp/work.todo" },
			}),
		}),
	});
	await expect.element(page.getByLabelText("No active workspace")).toBeVisible();
	await expect.element(page.getByText("Could not open /tmp/work.todo")).toBeVisible();
});
test("confirmed final deletion clears all App summary facts", async () => {
	render(Harness, {
		desktop: adapter({
			deleteTodo: async () => ({ status: "applied", confirmed: confirmedTodo([]) }),
		}),
	});
	await page.getByRole("button", { name: "Delete Plan release" }).click();
	await expect.element(page.getByText("Plan release", { exact: true })).not.toBeInTheDocument();
	await expect.element(page.getByLabelText("Summary counts")).toHaveTextContent("0/0/0");
	await expect.element(page.getByLabelText("Summary facets")).toHaveTextContent("");
});

test("duplicate creation submissions keep dismissal blocked until the admitted save settles", async () => {
	let calls = 0;
	let finish!: (result: Awaited<ReturnType<DesktopAPI["createTodo"]>>) => void;
	render(Harness, {
		desktop: adapter({
			createTodo: () => {
				calls++;
				return new Promise((resolve) => {
					finish = resolve;
				});
			},
		}),
	});
	const trigger = page.getByRole("button", { name: "Add Todo item", exact: true }).nth(0);
	await trigger.click();
	const description = page.getByPlaceholder("What needs doing?");
	await description.fill("Keep this draft");
	const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')!;
	form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
	form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
	await expect.poll(() => calls).toBe(1);
	// Allow both validation continuations and any busy rejection to settle.
	await new Promise((resolve) => setTimeout(resolve, 0));
	const close = page.getByRole("button", { name: "Close", exact: true });
	await expect.element(close).toBeDisabled();
	await expect.element(description).toBeDisabled();
	await expect.element(page.getByPlaceholder("Choose or create a Project")).toBeDisabled();
	await expect.element(page.getByPlaceholder("Choose or create a Context")).toBeDisabled();
	await expect.element(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
	expect(
		document.querySelector<HTMLButtonElement>('button[aria-label="Delete Plan release"]')?.disabled
	).toBe(true);
	(close.element() as HTMLButtonElement).click();
	description
		.element()
		.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	await new Promise((resolve) => setTimeout(resolve, 150));
	await expect.element(page.getByRole("dialog")).toBeVisible();
	await expect.element(description).toHaveValue("Keep this draft");
	finish({ status: "rejected", message: "Creation blocked by permissions" });
	await expect.element(description).toBeEnabled();
	await expect.element(page.getByText("Creation blocked by permissions")).toBeVisible();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect.element(trigger).toHaveFocus();
});

test("creation updates confirmed items, counts, and suggestions without moving the list, then resets and restores focus", async () => {
	if (initial.session.status !== "ready") throw Error("No initial file");
	const items = Array.from({ length: 40 }, (_, index) => ({
		...todo,
		line_number: index + 1,
		raw: `Existing item ${index} +Work`,
		description: `Existing item ${index}`,
	}));
	const loaded: ConfirmedSession = {
		...initial,
		session: { ...initial.session, todo_file: { ...initial.session.todo_file, items } },
	};
	const created = {
		...todo,
		line_number: 41,
		raw: "2026-10-09 Ship the release +work @Desk",
		description: "Ship the release",
		creation_date: "2026-10-09",
		projects: ["work"],
		contexts: ["Desk"],
	};
	let request: Parameters<DesktopAPI["createTodo"]>[0] | undefined;
	render(Harness, {
		desktop: adapter({
			restoreSession: async () => loaded,
			createTodo: async (input) => {
				request = input;
				return { status: "applied", confirmed: confirmedTodo([...items, created]) };
			},
		}),
	});
	const trigger = page.getByRole("button", { name: "Add Todo item", exact: true }).nth(0);
	await expect.element(trigger).toBeEnabled();
	const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
	viewport.scrollTop = 200;
	expect(viewport.scrollTop).toBe(200);
	await trigger.click();
	const description = page.getByPlaceholder("What needs doing?");
	await expect.element(description).toHaveFocus();
	await expect.element(page.getByText("Work · work.todo", { exact: true })).toBeVisible();
	const submit = page.getByRole("button", { name: "Add Todo item", exact: true }).nth(1);
	await description.fill("   ");
	await submit.click();
	await expect.element(page.getByText("Enter a Description.")).toBeVisible();
	await expect.element(submit).toBeEnabled();
	await description.fill("  Ship   the release  ");
	const projects = page.getByPlaceholder("Choose or create a Project");
	await projects.fill("+work");
	await expect.element(page.getByRole("option", { name: "Work", exact: true })).toBeVisible();
	projects.element().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	const contexts = page.getByPlaceholder("Choose or create a Context");
	await contexts.fill("@Desk");
	contexts.element().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	await submit.click();
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	await expect.element(trigger).toHaveFocus();
	expect(request).toEqual({
		scope,
		revision: 1,
		workspaceId,
		description: "Ship the release",
		projects: ["work"],
		contexts: ["Desk"],
	});
	await expect.element(page.getByLabelText("Summary counts")).toHaveTextContent("41/0/2");
	await expect.element(page.getByLabelText("Summary facets")).toHaveTextContent("work,Work");
	expect(viewport.scrollTop).toBe(200);
	// The appended item becomes available when scrolled into the virtual viewport.
	viewport.scrollTop = viewport.scrollHeight;
	await expect.element(page.getByText("Ship the release", { exact: true })).toBeVisible();
	expect(document.querySelector('[data-sonner-toast][data-type="success"]')).toBeNull();
	await trigger.click();
	await expect.element(description).toHaveFocus();
	await expect.element(description).toHaveValue("");
	await projects.click();
	await expect.element(page.getByRole("option", { name: "work", exact: true })).toBeVisible();
	await expect.element(page.getByRole("option", { name: "Work", exact: true })).toBeVisible();
	await contexts.click();
	await expect.element(page.getByRole("option", { name: "Desk", exact: true })).toBeVisible();
});

test.each(["conflict", "rejected"] as const)(
	"creation %s retains the draft and cancellation discards it",
	async (status) => {
		render(Harness, {
			desktop: adapter({
				createTodo: async () =>
					status === "conflict"
						? {
								status,
								message: "Changed on disk",
								confirmed: confirmedTodo([{ ...todo, projects: ["External"] }]),
							}
						: { status, message: "Permission denied" },
			}),
		});
		const trigger = page.getByRole("button", { name: "Add Todo item", exact: true }).nth(0);
		await trigger.click();
		const description = page.getByPlaceholder("What needs doing?");
		await description.fill("Retain this draft");
		const projects = page.getByPlaceholder("Choose or create a Project");
		await projects.fill("Draft");
		projects.element().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		await page.getByRole("button", { name: "Add Todo item", exact: true }).nth(1).click();
		await expect.element(description).toBeEnabled();
		await expect.element(description).toHaveValue("Retain this draft");
		await expect.element(page.getByText("+Draft", { exact: true })).toBeVisible();
		await expect
			.element(
				page
					.getByText(
						status === "conflict"
							? "Todo file changed externally; reloaded latest version"
							: "Permission denied"
					)
					.last()
			)
			.toBeVisible();
		if (status === "conflict") {
			await projects.click();
			await expect
				.element(page.getByRole("option", { name: "External", exact: true }))
				.toBeVisible();
			await expect
				.element(page.getByRole("option", { name: "Work", exact: true }))
				.not.toBeInTheDocument();
		}
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect.element(trigger).toHaveFocus();
		await trigger.click();
		await expect.element(description).toHaveValue("");
		await expect.element(page.getByText("+Draft", { exact: true })).not.toBeInTheDocument();
	}
);

test("a keyboard drop uses the confirmed session and keeps confirmed order while saving", async () => {
	const second = { ...todo, line_number: 3, raw: "Ship", description: "Ship" };
	const hidden = {
		...todo,
		line_number: 2,
		raw: "x 2026-10-10 Hidden",
		description: "Hidden",
		completed: true,
	};
	if (initial.session.status !== "ready") throw Error("Expected Ready session");
	const snapshot: ConfirmedSession = {
		...initial,
		session: {
			...initial.session,
			todo_file: { ...initial.session.todo_file, items: [todo, hidden, second] },
		},
	};
	let input: Parameters<DesktopAPI["reorderTodo"]>[0] | undefined;
	let finish!: (outcome: Awaited<ReturnType<DesktopAPI["reorderTodo"]>>) => void;
	render(Harness, {
		desktop: adapter({
			restoreSession: async () => snapshot,
			reorderTodo: (request) => {
				input = request;
				return new Promise((resolve) => {
					finish = resolve;
				});
			},
		}),
	});
	const handle = page.getByRole("button", { name: "Reorder Plan release", exact: true });
	await expect.element(handle).toBeVisible();
	(handle.element() as HTMLElement).focus();
	await userEvent.keyboard("{Space}{ArrowDown}{Space}");
	await expect.poll(() => input).toEqual({ scope, revision: 1, workspaceId, lineNumbers: [3, 1] });
	await expect.element(handle).toBeDisabled();
	await expect.element(page.getByRole("listitem").nth(0)).toMatchTextContent("Plan release");
	finish({
		status: "applied",
		confirmed: confirmedTodo([{ ...second, line_number: 1 }, hidden, { ...todo, line_number: 3 }]),
	});
	await expect.element(page.getByRole("listitem").nth(0)).toMatchTextContent("Ship");
	await expect.element(handle).not.toBeDisabled();
});
