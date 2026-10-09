import { page } from "vitest/browser";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import type { ConfirmedSession, DesktopAPI, TodoFile } from "$lib/shared/desktop/contract";
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
test("loading is a non-actionable Workspace session", async () => {
	render(Harness, { desktop: adapter({ restoreSession: () => new Promise(() => {}) }) });
	await expect.element(page.getByLabelText("Loading workspace session")).toBeVisible();
	await expect.element(page.getByRole("button")).not.toBeInTheDocument();
});
test("completion and uncompletion keep row controls and list position stable while applying confirmed data", async () => {
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
		.toBeChecked();
	await expect.element(page.getByLabelText("Summary counts")).toHaveTextContent("0/1/1");
	expect({
		pendingShift: pendingTop - initialTop,
		confirmedShift: list.getBoundingClientRect().top - initialTop,
		sameCheckbox: document.querySelector('[role="checkbox"]') === originalCheckbox,
	}).toEqual({ pendingShift: 0, confirmedShift: 0, sameCheckbox: true });

	const completedCheckbox = page.getByRole("checkbox", { name: "Mark Plan release incomplete" });
	await completedCheckbox.click();
	await expect.element(completedCheckbox).toBeDisabled();
	await expect.element(completedCheckbox).toBeChecked();
	await expect.element(page.getByText("Updating Todo file…")).toBeVisible();
	expect(list.getBoundingClientRect().top).toBe(initialTop);
	finish({ status: "applied", confirmed: { ...confirmedTodo([todo]), revision: 3 } });
	await expect.element(checkbox).not.toBeChecked();
	await expect.element(page.getByLabelText("Summary counts")).toHaveTextContent("1/0/1");
	expect(document.querySelector('[role="checkbox"]')).toBe(originalCheckbox);
	expect(list.getBoundingClientRect().top).toBe(initialTop);
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
