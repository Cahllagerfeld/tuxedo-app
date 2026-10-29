import { loaderDesktop } from "#lib/modules/workspace/state/testing/loader-desktop.js";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Harness from "./ElectronTodoHarness.svelte";
import type {
	ConfirmedSession,
	DesktopAPI,
	ConfirmedTodo,
	DesktopRequest,
} from "@tuxedo/contracts";
const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1",
	workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const item = {
	line_number: 1,
	raw: "(A) Call Mom +Family",
	completed: false,
	priority: "A",
	creation_date: null,
	completion_date: null,
	description: "Call Mom",
	projects: ["Family"],
	contexts: [],
	metadata: {},

	edit: { description: "Call Mom", metadata: [] },
};
const initial: ConfirmedSession = {
	scope,
	revision: 5,
	session: {
		status: "ready",
		catalogue: {
			version: 1,
			active_workspace_id: workspaceId,
			workspaces: [
				{
					id: workspaceId,
					name: "Personal",
					color: "blue",
					todo_path: "/tmp/todo.txt",
					created_at: "2026-07-10T10:00:00Z",
				},
			],
		},
		todo_file: { path: "/tmp/todo.txt", items: [item], skipped: [] },
	},
};
function adapter(completion: DesktopAPI["setTodoCompletion"]): DesktopAPI {
	return loaderDesktop({
		readSavedViews: async () => ({ status: "applied", workspaceId, views: [] }),
		saveView: async () => ({ status: "rejected", message: "unused" }),
		deleteView: async () => ({ status: "rejected", message: "unused" }),
		readSession: async () => initial,
		refreshSession: async () => initial,
		writeClipboardText: async () => null,
		selectTodoFile: async () => null,
		selectNewTodoFile: async () => null,
		createWorkspace: async () => ({ status: "rejected", message: "unused" }),
		switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
		deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
		editTodo: async () => ({ status: "rejected", message: "unused" }),
		deleteTodo: async () => ({ status: "rejected", message: "unused" }),
		reorderTodo: async () => ({ status: "rejected", message: "unused" }),
		moveTodoOnBoard: async () => ({ status: "rejected", message: "unused" }),
		createTodo: async () => ({ status: "rejected", message: "unused" }),
		setWorkspaceSortOrder: async () => ({ status: "rejected", message: "unused" }),
		setWorkspaceShowDeferred: async () => ({ status: "rejected", message: "unused" }),
		undoTodo: async () => ({ status: "rejected", message: "unused" }),
		setTodoCompletion: completion,
		bulkDeleteTodos: async () => ({ status: "rejected", message: "unused" }),
		bulkSetTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
	});
}
function updated(): ConfirmedTodo {
	return {
		scope,
		revision: 6,
		workspaceId,
		todo_file: {
			path: "/tmp/todo.txt",
			items: [
				{
					...item,
					completed: true,
					raw: "x 2026-07-11 Call Mom +Family pri:A",
					priority: null,
					metadata: { pri: "A" },
					completion_date: "2026-07-11",
				},
			],
			skipped: [],
		},
	};
}
test("completion binds target and preserves confirmed controls and summary until response", async () => {
	let request: DesktopRequest<"setTodoCompletion"> | undefined;
	let finish!: (result: Awaited<ReturnType<DesktopAPI["setTodoCompletion"]>>) => void;
	render(Harness, {
		desktop: adapter((input) => {
			request = input;
			return new Promise((resolve) => {
				finish = resolve;
			});
		}),
	});
	await expect.element(page.getByLabelText("Open count")).toHaveTextContent("1");
	await page.getByRole("checkbox", { name: "Mark Call Mom complete" }).click();
	await expect.element(page.getByRole("button", { name: "Restore" })).toBeDisabled();
	await expect
		.element(page.getByLabelText("Pending target"))
		.toHaveTextContent('{"workspaceId":"550e8400-e29b-41d4-a716-446655440000","lineNumber":1}');
	await expect
		.element(page.getByRole("checkbox", { name: "Mark Call Mom complete" }))
		.not.toBeChecked();
	expect(request).toEqual({
		scope,
		revision: 5,
		workspaceId,
		lineNumber: 1,
		expectedRaw: item.raw,
		completed: true,
	});
	finish({ status: "applied", confirmed: updated() });
	await expect
		.element(page.getByRole("checkbox", { name: "Mark Call Mom incomplete" }))
		.toBeChecked();
	await expect.element(page.getByLabelText("Open count")).toHaveTextContent("0");
	await expect.element(page.getByLabelText("Pending target")).toHaveTextContent("none");
});
