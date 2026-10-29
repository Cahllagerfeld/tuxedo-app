import { page } from "vitest/browser";
import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import type { ConfirmedSession, DesktopAPI, TodoFile } from "@tuxedo/contracts";
import Harness from "./WorkspaceFilteringHarness.svelte";
import { loaderDesktop } from "#lib/modules/workspace/state/testing/loader-desktop.js";
import "#lib/../routes/layout.css";

// A narrow viewport lets the Todo reader cover toolbar clicks until they time out.
beforeEach(() => page.viewport(1400, 900));

const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const secondWorkspaceId = "550e8400-e29b-41d4-a716-446655440001";
const items: TodoFile["items"] = [
	{
		line_number: 1,
		raw: "(A) Open work @Home",
		completed: false,
		priority: "A",
		creation_date: null,
		completion_date: null,
		description: "Open work",
		projects: ["Work"],
		contexts: ["Home"],
		metadata: {},

		edit: { description: "Open work", metadata: [] },
	},
	{
		line_number: 2,
		raw: "Open personal @Home",
		completed: false,
		priority: null,
		creation_date: null,
		completion_date: null,
		description: "Open personal",
		projects: ["Personal"],
		contexts: ["Home"],
		metadata: {},

		edit: { description: "Open personal", metadata: [] },
	},
	{
		line_number: 3,
		raw: "Open travel @Away",
		completed: false,
		priority: "B",
		creation_date: null,
		completion_date: null,
		description: "Open travel",
		projects: ["Travel"],
		contexts: ["Away"],
		metadata: {},

		edit: { description: "Open travel", metadata: [] },
	},
	{
		line_number: 4,
		raw: "Open errands +Errands @Away",
		completed: false,
		priority: null,
		creation_date: null,
		completion_date: null,
		description: "Open errands",
		projects: ["Errands"],
		contexts: ["Away"],
		metadata: {},

		edit: { description: "Open errands", metadata: [] },
	},
	{
		line_number: 5,
		raw: "Open reading +Reading @Away",
		completed: false,
		priority: null,
		creation_date: null,
		completion_date: null,
		description: "Open reading",
		projects: ["Reading"],
		contexts: ["Away"],
		metadata: {},

		edit: { description: "Open reading", metadata: [] },
	},
	{
		line_number: 6,
		raw: "Open garden +Garden @Away",
		completed: false,
		priority: null,
		creation_date: null,
		completion_date: null,
		description: "Open garden",
		projects: ["Garden"],
		contexts: ["Away"],
		metadata: {},

		edit: { description: "Open garden", metadata: [] },
	},
	{
		line_number: 7,
		raw: "x 2026-10-09 Completed work +Work @Home",
		completed: true,
		priority: null,
		creation_date: null,
		completion_date: "2026-10-09",
		description: "Completed work",
		projects: ["Work"],
		contexts: ["Home"],
		metadata: {},

		edit: { description: "Completed work", metadata: [] },
	},
];

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
				{
					id: secondWorkspaceId,
					name: "Review",
					color: "green",
					todo_path: "/tmp/review.todo",
					created_at: "2026-07-11T10:00:00Z",
				},
			],
		},
		todo_file: { path: "/tmp/work.todo", items, skipped: [] },
	},
};

function readySession(session: ConfirmedSession["session"]) {
	if (session.status !== "ready") throw Error("Expected a ready session");
	return session;
}

const initialReadySession = readySession(initial.session);

const secondWorkspaceSession: ConfirmedSession = {
	...initial,
	revision: 2,
	session: {
		...initialReadySession,
		catalogue: { ...initialReadySession.catalogue, active_workspace_id: secondWorkspaceId },
		todo_file: {
			path: "/tmp/review.todo",
			items: [
				{
					...items[0],
					line_number: 1,
					raw: "Review release +Review",
					description: "Review release",
					projects: ["Review"],
				},
				{
					...items[1],
					line_number: 2,
					raw: "Lowercase project +review",
					description: "Lowercase project",
					projects: ["review"],
				},
			],
			skipped: [],
		},
	},
};

function adapter(overrides: Partial<DesktopAPI> = {}): DesktopAPI {
	let current = initial;
	const desktop: Omit<DesktopAPI, "readWorkspace"> = {
		readSavedViews: async () => ({ status: "applied", workspaceId, views: [] }),
		saveView: async () => ({ status: "rejected", message: "unused" }),
		deleteView: async () => ({ status: "rejected", message: "unused" }),
		readSession: async () => initial,
		refreshSession: (input) => desktop.readSession(input),
		writeClipboardText: async () => null,
		selectTodoFile: async () => null,
		selectNewTodoFile: async () => null,
		createWorkspace: async () => ({ status: "rejected", message: "unused" }),
		switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
		deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
		setWorkspaceSortOrder: async () => ({ status: "rejected", message: "unused" }),
		setWorkspaceShowDeferred: async ({ showDeferred }) => {
			const ready = readySession(current.session);
			current = {
				...current,
				revision: current.revision + 1,
				session: {
					...ready,
					catalogue: {
						...ready.catalogue,
						workspaces: ready.catalogue.workspaces.map((w) =>
							w.id === ready.catalogue.active_workspace_id
								? { ...w, show_deferred: showDeferred }
								: w
						),
					},
				},
			};
			return { status: "applied", confirmed: current };
		},
		undoTodo: async () => ({ status: "rejected", message: "unused" }),
		setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
		bulkSetTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
		bulkDeleteTodos: async () => ({ status: "rejected", message: "unused" }),
		editTodo: async () => ({ status: "rejected", message: "unused" }),
		deleteTodo: async () => ({ status: "rejected", message: "unused" }),
		reorderTodo: async () => ({ status: "rejected", message: "unused" }),
		moveTodoOnBoard: async () => ({ status: "rejected", message: "unused" }),
		reorderTodosOnBoard: async () => ({ status: "rejected", message: "unused" }),
		createTodo: async () => ({ status: "rejected", message: "unused" }),
		...overrides,
	};
	const read = desktop.readSession;
	desktop.readSession = async () => (current = await read({}));
	const switchWorkspace = desktop.switchWorkspace;
	desktop.switchWorkspace = async (request) => {
		const outcome = await switchWorkspace(request);
		if (outcome.status === "applied") current = outcome.confirmed;
		return outcome;
	};
	const complete = desktop.setTodoCompletion;
	desktop.setTodoCompletion = async (request) => {
		const outcome = await complete(request);
		if (outcome.status === "applied" || outcome.status === "conflict") {
			current = {
				...current,
				scope: outcome.confirmed.scope,
				revision: outcome.confirmed.revision,
				session: { ...readySession(current.session), todo_file: outcome.confirmed.todo_file },
			};
		}
		return outcome;
	};
	return loaderDesktop(desktop);
}

test("Todo-item search combines with facets and clears independently or with all filters", async () => {
	await render(Harness, { desktop: adapter() });
	const search = page.getByRole("searchbox", { name: "Search Todo items" });
	await expect.element(search).not.toBeInTheDocument();
	await page.getByRole("button", { name: "Toggle Todo-item search" }).click();
	await expect.element(search).toHaveFocus();
	await search.fill("HOME work");
	await expect.element(page.getByLabelText("Active filters")).not.toBeInTheDocument();
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("2 matching items");
	await page.getByRole("button", { name: "Priority A", exact: true }).click();
	await expect.element(page.getByLabelText("Active filters")).toBeVisible();
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("1 matching item");
	await search.fill("unmatched");
	await expect.element(page.getByLabelText("No matching Todo items")).toBeVisible();
	await expect.element(search).toHaveValue("unmatched");
	await expect
		.element(page.getByLabelText("No matching Todo items").getByRole("button"))
		.toHaveTextContent("Clear filters");
	await page
		.getByLabelText("No matching Todo items")
		.getByRole("button", { name: "Clear filters", exact: true })
		.click();
	await expect.element(search).toHaveValue("");
	await expect
		.element(page.getByRole("button", { name: "Priority A", exact: true }))
		.toHaveAttribute("aria-pressed", "false");
	await page.getByRole("button", { name: "Priority A", exact: true }).click();
	await search.fill("work");
	await page.getByRole("button", { name: "Clear search", exact: true }).click();
	await expect.element(search).toHaveValue("");
	await search.fill("work");
	await page
		.getByLabelText("Active filters")
		.getByRole("button", { name: "Clear filters", exact: true })
		.click();
	await expect.element(search).toHaveValue("");
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("7 matching items");
	await search.fill("reading");
	await expect.element(page.getByLabelText("Active filters")).not.toBeInTheDocument();
	await page.getByRole("button", { name: "Toggle Todo-item search" }).click();
	await expect.element(search).not.toBeInTheDocument();
	await page.getByRole("button", { name: "Toggle Todo-item search" }).click();
	await expect.element(search).toHaveValue("");
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("7 matching items");
});

test("Show deferred is a Workspace preference outside the filter bar and Clear filters", async () => {
	render(Harness, { desktop: adapter() });
	const toggle = page.getByRole("button", { name: "Show deferred", exact: true });
	await toggle.click();
	await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
	await expect.element(page.getByLabelText("Active filters")).not.toBeInTheDocument();
	await page.getByRole("button", { name: "@Home", exact: true }).click();
	await page.getByRole("button", { name: "Clear filters", exact: true }).click();
	await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
	await expect.element(page.getByLabelText("Active filters")).not.toBeInTheDocument();
	await toggle.click();
	await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
});

test("restores saved Show deferred and preserves it when a preference save fails", async () => {
	render(Harness, {
		desktop: adapter({
			readSession: async () => ({
				...initial,
				session: {
					...initialReadySession,
					catalogue: {
						...initialReadySession.catalogue,
						workspaces: initialReadySession.catalogue.workspaces.map((w) => ({
							...w,
							show_deferred: true,
						})),
					},
				},
			}),
			setWorkspaceShowDeferred: async () => ({
				status: "rejected",
				message: "Read-only catalogue",
			}),
		}),
	});
	const toggle = page.getByRole("button", { name: "Show deferred", exact: true });
	await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
	await toggle.click();
	await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
	await expect.element(page.getByLabelText("Active filters")).not.toBeInTheDocument();
});
