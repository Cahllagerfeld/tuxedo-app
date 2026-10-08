import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ElectronSessionHarness from "./ElectronSessionHarness.svelte";
import type { ConfirmedSession } from "$lib/shared/desktop/contract";
const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const confirmed = (revision: number, warning: string | null): ConfirmedSession => ({
	scope,
	revision,
	session: {
		status: "empty",
		catalogue: { version: 1, workspaces: [], active_workspace_id: null },
		warning,
	},
});
test("confirmed restoration rejects older results and exposes pending lifecycle state", async () => {
	let finish!: (value: ConfirmedSession) => void;
	render(ElectronSessionHarness, {
		desktop: {
			setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
			deleteTodo: async () => ({ status: "rejected", message: "unused" }),
			switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
			selectTodoFile: async () => null,
			deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
			createWorkspace: async () => ({ status: "rejected", message: "unused" }),
			readSession: async () => confirmed(5, "Confirmed"),
			restoreSession: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		},
	});
	await expect.element(page.getByLabelText("Session warning")).toHaveTextContent("Confirmed");
	await page.getByRole("button", { name: "Restore" }).click();
	await expect.element(page.getByLabelText("Pending operation")).toHaveTextContent("restore");
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("empty");
	finish(confirmed(4, "Stale"));
	await expect.element(page.getByLabelText("Pending operation")).toHaveTextContent("none");
	await expect.element(page.getByLabelText("Session warning")).toHaveTextContent("Confirmed");
});
test("creation keeps the confirmed summary while pending and applies a coherent Ready session", async () => {
	let finish!: (
		value: Awaited<ReturnType<import("$lib/shared/desktop/contract").DesktopAPI["createWorkspace"]>>
	) => void;
	const workspace = {
		id: "550e8400-e29b-41d4-a716-446655440000",
		name: "Personal",
		color: "blue" as const,
		todo_path: "/tmp/todo.txt",
		created_at: "2026-07-10T10:00:00Z",
	};
	render(ElectronSessionHarness, {
		desktop: {
			setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
			deleteTodo: async () => ({ status: "rejected", message: "unused" }),
			readSession: async () => confirmed(1, null),
			restoreSession: async () => confirmed(1, null),
			switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
			selectTodoFile: async () => null,
			deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
			createWorkspace: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		},
	});
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("empty");
	await page.getByRole("button", { name: "Create" }).click();
	await expect
		.element(page.getByLabelText("Pending operation"))
		.toHaveTextContent("create_workspace");
	await expect.element(page.getByLabelText("Item count")).toHaveTextContent("0");
	finish({
		status: "applied",
		confirmed: {
			scope,
			revision: 2,
			session: {
				status: "ready",
				catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
				todo_file: {
					path: workspace.todo_path,
					items: [
						{
							line_number: 1,
							raw: "Call Mom +Family",
							completed: false,
							priority: null,
							creation_date: null,
							completion_date: null,
							description: "Call Mom",
							projects: ["Family"],
							contexts: [],
							metadata: {},
						},
					],
					skipped: [],
				},
			},
		},
	});
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("ready");
	await expect.element(page.getByLabelText("Item count")).toHaveTextContent("1");
	await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("Personal");
});
test("rejected creation preserves the current confirmed file and summary", async () => {
	const initial: ConfirmedSession = {
		scope,
		revision: 4,
		session: {
			status: "ready",
			catalogue: {
				version: 1,
				active_workspace_id: "550e8400-e29b-41d4-a716-446655440000",
				workspaces: [
					{
						id: "550e8400-e29b-41d4-a716-446655440000",
						name: "Existing",
						color: "blue",
						todo_path: "/tmp/existing.todo",
						created_at: "2026-07-10T10:00:00Z",
					},
				],
			},
			todo_file: { path: "/tmp/existing.todo", items: [], skipped: [] },
		},
	};
	render(ElectronSessionHarness, {
		desktop: {
			setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
			deleteTodo: async () => ({ status: "rejected", message: "unused" }),
			readSession: async () => initial,
			restoreSession: async () => initial,
			switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
			selectTodoFile: async () => null,
			deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
			createWorkspace: async () => ({ status: "rejected", message: "Duplicate Workspace name" }),
		},
	});
	await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("Existing");
	await page.getByRole("button", { name: "Create" }).click();
	await expect
		.element(page.getByLabelText("Action result"))
		.toHaveTextContent("Duplicate Workspace name");
	await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("Existing");
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("ready");
});

test("switching preserves a confirmed session on rejection and exposes pending controls", async () => {
	let finish!: (
		outcome: Awaited<
			ReturnType<import("$lib/shared/desktop/contract").DesktopAPI["switchWorkspace"]>
		>
	) => void;
	render(ElectronSessionHarness, {
		desktop: {
			setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
			deleteTodo: async () => ({ status: "rejected", message: "unused" }),
			readSession: async () => confirmed(5, "Original"),
			restoreSession: async () => confirmed(5, "Original"),
			selectTodoFile: async () => null,
			createWorkspace: async () => ({ status: "rejected", message: "unused" }),
			deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
			switchWorkspace: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		},
	});
	await expect.element(page.getByLabelText("Session warning")).toHaveTextContent("Original");
	await page.getByRole("button", { name: "Switch" }).click();
	await expect
		.element(page.getByLabelText("Pending operation"))
		.toHaveTextContent("open_workspace");
	await expect.element(page.getByRole("button", { name: "Create" })).toBeDisabled();
	finish({ status: "rejected", message: "Cannot open file" });
	await expect.element(page.getByLabelText("Action result")).toHaveTextContent("Cannot open file");
	await expect.element(page.getByLabelText("Session warning")).toHaveTextContent("Original");
	await expect.element(page.getByLabelText("Pending operation")).toHaveTextContent("none");
});

test("a confirmed switch opens its intended Workspace through the shared cache", async () => {
	const workspace = {
		id: "550e8400-e29b-41d4-a716-446655440000",
		name: "Switched",
		color: "blue" as const,
		todo_path: "/tmp/switched.todo",
		created_at: "2026-07-10T10:00:00Z",
	};
	let requestedId: string | undefined;
	render(ElectronSessionHarness, {
		desktop: {
			setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
			deleteTodo: async () => ({ status: "rejected", message: "unused" }),
			readSession: async () => confirmed(5, null),
			restoreSession: async () => confirmed(5, null),
			selectTodoFile: async () => null,
			createWorkspace: async () => ({ status: "rejected", message: "unused" }),
			deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
			switchWorkspace: async ({ workspaceId }) => {
				requestedId = workspaceId;
				return {
					status: "applied",
					confirmed: {
						scope,
						revision: 6,
						session: {
							status: "ready",
							catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
							todo_file: { path: workspace.todo_path, items: [], skipped: [] },
						},
					},
				};
			},
		},
	});
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("empty");
	await page.getByRole("button", { name: "Switch" }).click();
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("ready");
	await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("Switched");
	expect(requestedId).toBe(workspace.id);
});
