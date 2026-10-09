import { page } from "vitest/browser";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import type { ConfirmedSession, DesktopAPI, TodoFile } from "$lib/shared/desktop/contract";
import Harness from "./WorkspaceFilteringHarness.svelte";
import "../../../../routes/layout.css";

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
	return {
		readSession: async () => initial,
		restoreSession: async () => initial,
		selectTodoFile: async () => null,
		createWorkspace: async () => ({ status: "rejected", message: "unused" }),
		switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
		deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
		setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
		deleteTodo: async () => ({ status: "rejected", message: "unused" }),
		createTodo: async () => ({ status: "rejected", message: "unused" }),
		...overrides,
	};
}

function rowCount() {
	return document.querySelectorAll('ul[aria-label="Todo items"] > li').length;
}

function confirmedTodo(itemsToConfirm: TodoFile["items"]) {
	return {
		status: "applied" as const,
		confirmed: {
			scope,
			revision: 2,
			workspaceId,
			todo_file: { path: "/tmp/work.todo", items: itemsToConfirm, skipped: [] },
		},
	};
}

test("defaults to Open and combines exact Project and Context filters", async () => {
	render(Harness, { desktop: adapter() });
	await expect.element(page.getByText("Open work", { exact: true })).toBeVisible();
	await expect.element(page.getByText("Completed work", { exact: true })).not.toBeInTheDocument();
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("6 matching items");

	await page.getByRole("button", { name: "Show all Projects values" }).click();
	await page.getByRole("option", { name: "+Work", exact: true }).click();
	await expect
		.element(page.getByRole("button", { name: "+Work", exact: true }))
		.toHaveAttribute("aria-pressed", "true");
	await page.getByRole("button", { name: "@Home", exact: true }).click();
	await expect
		.element(page.getByRole("button", { name: "@Home", exact: true }))
		.toHaveAttribute("aria-pressed", "true");
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("1 matching item");
	await expect.element(page.getByText("Open work", { exact: true })).toBeVisible();
	await expect.element(page.getByText("Open personal", { exact: true })).not.toBeInTheDocument();

	await page.getByRole("button", { name: /^Completed/ }).click();
	await expect.element(page.getByText("Completed work", { exact: true })).toBeVisible();
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("1 matching item");
	await page.getByRole("button", { name: "Clear filters", exact: true }).click();
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("1 matching item");
});

test("searches bounded facet values and remembers a Priority across status changes", async () => {
	render(Harness, { desktop: adapter() });
	await expect
		.element(page.getByRole("button", { name: "Show all Projects values" }))
		.toBeVisible();
	await page.getByRole("button", { name: "Show all Projects values" }).click();
	const search = page.getByPlaceholder("Search projects…");
	await search.fill("read");
	await expect.element(page.getByRole("option", { name: "+Reading", exact: true })).toBeVisible();
	await expect
		.element(page.getByRole("option", { name: "+Garden", exact: true }))
		.not.toBeInTheDocument();
	await page.getByRole("option", { name: "+Reading", exact: true }).click();
	await expect.element(page.getByRole("button", { name: "+Reading", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "+Reading", exact: true }).click();

	await page.getByRole("button", { name: "A", exact: true }).click();
	await expect.poll(rowCount).toBe(1);
	await page.getByRole("button", { name: /^Completed/ }).click();
	await expect.element(page.getByRole("button", { name: "A", exact: true })).toBeDisabled();
	await expect.poll(rowCount).toBe(1);
	await page.getByRole("button", { name: /^Open/ }).click();
	await expect.poll(rowCount).toBe(1);
});

test("uses literal case-insensitive substring search and clears no-results state", async () => {
	render(Harness, { desktop: adapter() });
	const picker = page.getByRole("button", { name: "Show all Projects values" });
	await picker.click();
	const search = page.getByPlaceholder("Search projects…");
	await search.fill("grd");
	await expect
		.element(page.getByRole("option", { name: "+Garden", exact: true }))
		.not.toBeInTheDocument();
	await expect.element(page.getByText("No projects found.", { exact: true })).toBeVisible();
	await search.fill("read");
	await page.getByRole("option", { name: "+Reading", exact: true }).click();
	await page.getByRole("button", { name: "@Home", exact: true }).click();
	await expect.element(page.getByLabelText("No matching Todo items")).toBeVisible();
	await page
		.getByLabelText("No matching Todo items")
		.getByRole("button", { name: "Clear filters", exact: true })
		.click();
	await expect.element(page.getByText("Open work", { exact: true })).toBeVisible();
});

test("supports keyboard selection, Escape dismissal, and focus return", async () => {
	render(Harness, { desktop: adapter() });
	const picker = page.getByRole("button", { name: "Show all Projects values" });
	await picker.click();
	const search = page.getByPlaceholder("Search projects…");
	await expect.element(search).toHaveFocus();
	const input = search.element() as HTMLInputElement;
	input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
	await new Promise((resolve) => setTimeout(resolve, 0));
	input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	await expect
		.poll(() => document.querySelectorAll('button[aria-pressed="true"][aria-label^="+"]').length)
		.toBe(1);
	await expect.element(picker).toHaveFocus();

	await picker.click();
	const reopenedSearch = page.getByPlaceholder("Search projects…");
	await expect.element(reopenedSearch).toHaveFocus();
	(reopenedSearch.element() as HTMLInputElement).dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
	);
	await expect.element(reopenedSearch).not.toBeInTheDocument();
	await expect.element(picker).toHaveFocus();
});

test("resets filters after a successful Workspace switch", async () => {
	render(Harness, {
		desktop: adapter({
			switchWorkspace: async () => ({ status: "applied", confirmed: secondWorkspaceSession }),
		}),
	});
	await page.getByRole("button", { name: "Show all Projects values" }).click();
	await page.getByRole("option", { name: "+Work", exact: true }).click();
	await page.getByRole("button", { name: /^Completed/ }).click();
	await page.getByRole("button", { name: /Select workspace: Work/ }).click();
	await page.getByRole("menuitem", { name: "Review" }).click();
	await expect
		.element(page.getByRole("button", { name: /^Open/ }))
		.toHaveAttribute("aria-pressed", "true");
	await expect
		.element(page.getByRole("button", { name: "Clear filters", exact: true }))
		.not.toBeInTheDocument();
	await expect.element(page.getByText("Review release", { exact: true })).toBeVisible();
});

test("preserves distinct Project spellings as separate choices", async () => {
	render(Harness, {
		desktop: adapter({
			switchWorkspace: async () => ({ status: "applied", confirmed: secondWorkspaceSession }),
		}),
	});
	await page.getByRole("button", { name: /Select workspace: Work/ }).click();
	await page.getByRole("menuitem", { name: "Review" }).click();
	await expect.element(page.getByRole("button", { name: "+Review", exact: true })).toBeVisible();
	await expect.element(page.getByRole("button", { name: "+review", exact: true })).toBeVisible();
	await expect.element(page.getByText("Review release", { exact: true })).toBeVisible();
	await expect.element(page.getByText("Lowercase project", { exact: true })).toBeVisible();
});

test("preserves filters after a rejected Workspace switch", async () => {
	render(Harness, {
		desktop: adapter({
			switchWorkspace: async () => ({ status: "rejected", message: "Cannot open workspace" }),
		}),
	});
	await page.getByRole("button", { name: "Show all Projects values" }).click();
	await page.getByRole("option", { name: "+Work", exact: true }).click();
	await page.getByRole("button", { name: /Select workspace: Work/ }).click();
	await page.getByRole("menuitem", { name: "Review" }).click();
	await expect
		.element(page.getByRole("button", { name: "+Work", exact: true }))
		.toHaveAttribute("aria-pressed", "true");
	await expect.element(page.getByText("Open work", { exact: true })).toBeVisible();
});

test("updates the filtered view only after accepted completion", async () => {
	let finish!: (result: ReturnType<typeof confirmedTodo>) => void;
	render(Harness, {
		desktop: adapter({
			setTodoCompletion: () => new Promise((resolve) => (finish = resolve)),
		}),
	});
	await page.getByRole("button", { name: "Show all Projects values" }).click();
	await page.getByRole("option", { name: "+Work", exact: true }).click();
	const checkbox = page.getByRole("checkbox", { name: "Mark Open work complete" });
	await checkbox.click();
	await expect.element(page.getByText("Open work", { exact: true })).toBeVisible();
	finish(
		confirmedTodo([
			{
				...items[0],
				completed: true,
				raw: "x 2026-10-09 Open work @Home",
				completion_date: "2026-10-09",
			},
		])
	);
	await expect.element(page.getByText("Open work", { exact: true })).not.toBeInTheDocument();
});

test("preserves the filtered view after a rejected completion", async () => {
	render(Harness, {
		desktop: adapter({
			setTodoCompletion: async () => ({ status: "rejected", message: "Cannot complete" }),
		}),
	});
	await page.getByRole("button", { name: "Show all Projects values" }).click();
	await page.getByRole("option", { name: "+Work", exact: true }).click();
	await page.getByRole("checkbox", { name: "Mark Open work complete" }).click();
	await expect.element(page.getByText("Open work", { exact: true })).toBeVisible();
});
