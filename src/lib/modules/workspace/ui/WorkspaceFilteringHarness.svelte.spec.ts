import { page } from "vitest/browser";
import { expect, test, vi } from "vitest";
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
	const desktop: DesktopAPI = {
		readSavedViews: async () => ({ status: "applied", views: [] }),
		saveView: async () => ({ status: "rejected", message: "unused" }),
		deleteView: async () => ({ status: "rejected", message: "unused" }),
		readSession: async () => initial,
		restoreSession: async () => initial,
		writeClipboardText: async () => null,
		selectTodoFile: async () => null,
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
		createTodo: async () => ({ status: "rejected", message: "unused" }),
		...overrides,
	};
	const restore = desktop.restoreSession;
	desktop.restoreSession = async (request) => (current = await restore(request));
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
	return desktop;
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

test("date filters and row indicators refresh at local midnight and clear with other filters", async () => {
	const datedItems = [
		{ ...items[0], metadata: { due: "2026-10-14" } },
		{ ...items[1], metadata: { due: "2026-10-15" } },
	];
	const view = await render(Harness, {
		desktop: adapter({
			restoreSession: async () => ({
				...initial,
				session: {
					...initialReadySession,
					todo_file: { ...initialReadySession.todo_file, items: datedItems },
				},
			}),
		}),
	});
	await expect
		.element(page.getByRole("checkbox", { name: "Mark Open work complete", exact: true }))
		.toBeVisible();
	vi.useFakeTimers({ toFake: ["Date"] });
	try {
		vi.setSystemTime(new Date(2026, 9, 14, 23, 59, 59));
		window.dispatchEvent(new Event("focus"));
		await page.getByRole("button", { name: "Today", exact: true }).click();
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Open personal complete", exact: true }))
			.not.toBeInTheDocument();
		await expect.element(page.getByTitle("Today · 2026-10-14", { exact: true })).toBeVisible();
		vi.setSystemTime(new Date(2026, 9, 15));
		await expect.element(page.getByTitle("Today · 2026-10-15", { exact: true })).toBeVisible();
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Open work complete", exact: true }))
			.not.toBeInTheDocument();
		await page.getByRole("button", { name: "Clear Due Today", exact: true }).click();
		await expect.element(page.getByTitle("Overdue · 2026-10-14", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "No due date", exact: true }).click();
		await expect
			.element(page.getByRole("button", { name: "Clear filters", exact: true }).last())
			.toBeVisible();
		await page.getByRole("button", { name: "Clear filters", exact: true }).last().click();
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Open work complete", exact: true }))
			.toBeVisible();
	} finally {
		view.unmount();
		vi.useRealTimers();
	}
});

test("shows a counted repair filter only while open invalid Due dates exist", async () => {
	const invalidItems: TodoFile["items"] = [
		{ ...items[0], metadata: { due: "broken" } },
		{ ...items[1], metadata: {} },
	];
	await render(Harness, {
		desktop: adapter({
			restoreSession: async () => ({
				...initial,
				session: {
					...initialReadySession,
					todo_file: { ...initialReadySession.todo_file, items: invalidItems },
				},
			}),
		}),
	});
	const repair = page
		.getByLabelText("Sidebar filters")
		.getByRole("button", { name: "Invalid due date", exact: true });
	await expect.element(repair).toHaveTextContent("Invalid due date1");
	await repair.click();
	await expect
		.element(page.getByRole("checkbox", { name: "Mark Open work complete", exact: true }))
		.toBeVisible();
	await expect
		.element(page.getByRole("checkbox", { name: "Mark Open personal complete", exact: true }))
		.not.toBeInTheDocument();
	await page.getByRole("button", { name: "Clear Due Invalid due date", exact: true }).click();
	await page.getByRole("button", { name: "No due date", exact: true }).click();
	await expect
		.element(page.getByRole("checkbox", { name: "Mark Open personal complete", exact: true }))
		.toBeVisible();
	await expect
		.element(page.getByRole("checkbox", { name: "Mark Open work complete", exact: true }))
		.not.toBeInTheDocument();
	await page.getByRole("button", { name: /^Completed/ }).click();
	await expect.element(repair).not.toBeInTheDocument();
});

test("creation seeds active Project and Context filters and refreshes them on reopening", async () => {
	let request: Parameters<DesktopAPI["createTodo"]>[0] | undefined;
	render(Harness, {
		desktop: adapter({
			createTodo: async (input) => {
				request = input;
				return { status: "rejected", message: "Keep the draft open" };
			},
		}),
	});
	await page.getByRole("button", { name: "Show more Projects" }).click();
	await page.getByRole("button", { name: "+Work", exact: true }).click();
	await page.getByRole("button", { name: "@Home", exact: true }).click();
	await page.getByRole("button", { name: "Priority A", exact: true }).click();
	const trigger = page.getByRole("button", { name: "Add Todo item", exact: true }).nth(0);
	await trigger.click();
	const dialog = page.getByRole("dialog", { name: "New Todo item" });
	await expect
		.element(dialog.getByRole("button", { name: "Remove +Work", exact: true }))
		.toBeVisible();
	await expect
		.element(dialog.getByRole("button", { name: "Remove @Home", exact: true }))
		.toBeVisible();
	await page.getByPlaceholder("What needs doing?").fill("New work");
	await dialog.getByRole("button", { name: "Add Todo item", exact: true }).click();
	await expect
		.poll(() => request)
		.toMatchObject({
			projects: ["Work"],
			contexts: ["Home"],
			priority: null,
			completed: false,
		});
	await dialog.getByRole("button", { name: "Remove +Work", exact: true }).click();
	await dialog.getByRole("button", { name: "Remove @Home", exact: true }).click();
	await dialog.getByRole("button", { name: "Add Todo item", exact: true }).click();
	await expect.poll(() => request).toMatchObject({ projects: [], contexts: [] });
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.getByRole("button", { name: "Clear Project Work", exact: true }).click();
	await page.getByRole("button", { name: "Clear Context Home", exact: true }).click();
	await page.getByRole("button", { name: "+Personal", exact: true }).click();
	await trigger.click();
	await expect
		.element(dialog.getByRole("button", { name: "Remove +Personal", exact: true }))
		.toBeVisible();
	await expect
		.element(dialog.getByRole("button", { name: "Remove +Work", exact: true }))
		.not.toBeInTheDocument();
	await expect
		.element(dialog.getByRole("button", { name: "Remove @Home", exact: true }))
		.not.toBeInTheDocument();
});

test("defaults to All with both completion states, the total count, and existing facet filters", async () => {
	render(Harness, { desktop: adapter() });
	const all = page.getByRole("button", { name: "All 7", exact: true });
	await expect.element(all).toBeVisible();
	await expect.element(all).toHaveAttribute("aria-pressed", "true");
	await expect
		.element(page.getByRole("button", { name: "Invalid due date", exact: true }))
		.not.toBeInTheDocument();
	await expect.element(page.getByText("Open work", { exact: true })).toBeVisible();
	await expect.element(page.getByText("Completed work", { exact: true })).toBeVisible();
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("7 matching items");

	await page.getByRole("button", { name: "Show more Projects" }).click();
	await page.getByRole("button", { name: "+Work", exact: true }).click();
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("2 matching items");
	await page.getByRole("button", { name: "Priority A", exact: true }).click();
	await expect.element(page.getByText("Completed work", { exact: true })).not.toBeInTheDocument();
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("1 matching item");

	await page.getByRole("button", { name: "No due date", exact: true }).click();
	await page.getByRole("button", { name: /^Completed/ }).click();
	await expect
		.element(page.getByRole("button", { name: "Clear Due No due date", exact: true }))
		.not.toBeInTheDocument();
	for (const name of ["Overdue", "Today", "Upcoming", "No due date"]) {
		await expect.element(page.getByRole("button", { name, exact: true })).toBeDisabled();
	}
	await expect.element(page.getByText("Completed work", { exact: true })).toBeVisible();
	await all.click();
	await expect.element(page.getByRole("button", { name: "Overdue", exact: true })).toBeEnabled();
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("2 matching items");
});

test("Open combines exact Project and Context filters", async () => {
	render(Harness, { desktop: adapter() });
	await page.getByRole("button", { name: /^Open/ }).click();
	await expect.element(page.getByText("Open work", { exact: true })).toBeVisible();
	await expect.element(page.getByText("Completed work", { exact: true })).not.toBeInTheDocument();
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("6 matching items");

	await page.getByRole("button", { name: "Show more Projects" }).click();
	await page.getByRole("button", { name: "+Work", exact: true }).click();
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
	await page
		.getByLabelText("Active filters")
		.getByRole("button", { name: "Clear filters", exact: true })
		.click();
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("1 matching item");
});

test("searches bounded facet values and clears a Priority across status changes", async () => {
	render(Harness, { desktop: adapter() });
	await expect.element(page.getByRole("button", { name: "Show more Projects" })).toBeVisible();
	await page.getByRole("button", { name: "Show more Projects" }).click();
	const search = page.getByRole("searchbox", { name: "Find a filter" });
	await search.fill("read");
	await expect.element(page.getByRole("button", { name: "+Reading", exact: true })).toBeVisible();
	await expect
		.element(page.getByRole("button", { name: "+Garden", exact: true }))
		.not.toBeInTheDocument();
	await page.getByRole("button", { name: "+Reading", exact: true }).click();
	await expect.element(page.getByRole("button", { name: "+Reading", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "+Reading", exact: true }).click();
	await page.getByRole("button", { name: "Clear filter search" }).click();

	await page.getByRole("button", { name: "Priority A", exact: true }).click();
	await expect.poll(rowCount).toBe(1);
	await page.getByRole("button", { name: /^Completed/ }).click();
	await expect
		.element(page.getByRole("button", { name: "Priority A", exact: true }))
		.not.toBeInTheDocument();
	await expect.poll(rowCount).toBe(1);
	await page.getByRole("button", { name: /^Open/ }).click();
	await expect.poll(rowCount).toBe(6);
});

test("uses literal case-insensitive substring search and clears no-results state", async () => {
	render(Harness, { desktop: adapter() });
	const picker = page.getByRole("button", { name: "Show more Projects" });
	await picker.click();
	const search = page.getByRole("searchbox", { name: "Find a filter" });
	await search.fill("grd");
	await expect
		.element(page.getByRole("button", { name: "+Garden", exact: true }))
		.not.toBeInTheDocument();
	await expect.element(page.getByText("No projects found.", { exact: true })).toBeVisible();
	await search.fill("read");
	await page.getByRole("button", { name: "+Reading", exact: true }).click();
	await page.getByRole("button", { name: "Clear filter search" }).click();
	await page.getByRole("button", { name: "@Home", exact: true }).click();
	await expect.element(page.getByLabelText("No matching Todo items")).toBeVisible();
	await page
		.getByLabelText("No matching Todo items")
		.getByRole("button", { name: "Clear filters", exact: true })
		.click();
	await expect.element(page.getByText("Open work", { exact: true })).toBeVisible();
});

test("expands inline choices, collapses Contexts, and removes individual active filters", async () => {
	render(Harness, { desktop: adapter() });
	await page.getByRole("button", { name: /^Open/ }).click();
	const more = page.getByRole("button", { name: "Show more Projects" });
	await expect
		.element(page.getByRole("button", { name: "+Work", exact: true }))
		.not.toBeInTheDocument();
	await more.click();
	await page.getByRole("button", { name: "+Work", exact: true }).click();
	await page.getByRole("button", { name: "Show fewer Projects" }).click();
	await expect
		.element(page.getByRole("button", { name: "+Work", exact: true }))
		.toHaveAttribute("aria-pressed", "true");
	await page.getByRole("button", { name: "Contexts", exact: true }).click();
	await expect
		.element(page.getByRole("button", { name: "@Home", exact: true }))
		.not.toBeInTheDocument();
	const search = page.getByRole("searchbox", { name: "Find a filter" });
	await search.fill("@home");
	await page.getByRole("button", { name: "@Home", exact: true }).click();
	await page.getByRole("button", { name: "Clear filter search" }).click();
	await expect
		.element(page.getByRole("button", { name: "@Home", exact: true }))
		.not.toBeInTheDocument();
	await page.getByRole("button", { name: "Clear Project Work", exact: true }).click();
	await expect.poll(rowCount).toBe(2);
	await expect
		.element(page.getByRole("button", { name: "Clear Context Home", exact: true }))
		.toBeVisible();
	await page.getByRole("button", { name: "Clear Context Home", exact: true }).click();
	await expect.poll(rowCount).toBe(6);
});

test.each([
	{
		label: "Projects",
		choice: "+Garden",
		search: "+garden",
		chip: "Clear Project Garden",
		count: 1,
	},
	{ label: "Contexts", choice: "@Home", search: "@home", chip: "Clear Context Home", count: 2 },
	{ label: "Priorities", choice: "Priority A", search: "A", chip: "Clear Priority A", count: 1 },
])(
	"collapses and reopens $label without clearing its selection",
	async ({ label, choice, search, chip, count }) => {
		render(Harness, { desktop: adapter() });
		await page.getByRole("button", { name: /^Open/ }).click();
		const header = page.getByRole("button", { name: label, exact: true });
		const option = page.getByRole("button", { name: choice, exact: true });
		await expect.element(header).toHaveAttribute("aria-expanded", "true");
		await option.click();
		await header.click();
		await expect.element(header).toHaveAttribute("aria-expanded", "false");
		await expect.element(option).not.toBeInTheDocument();
		await expect.element(page.getByRole("button", { name: chip, exact: true })).toBeVisible();
		await expect.poll(rowCount).toBe(count);
		await page.getByRole("searchbox", { name: "Find a filter" }).fill(search);
		await expect.element(header).toHaveAttribute("aria-expanded", "true");
		await expect.element(option).toHaveAttribute("aria-pressed", "true");
		await page.getByRole("button", { name: "Clear filter search" }).click();
		await expect.element(header).toHaveAttribute("aria-expanded", "false");
		await expect.element(option).not.toBeInTheDocument();
		await header.click();
		await expect.element(header).toHaveAttribute("aria-expanded", "true");
		await expect.element(option).toHaveAttribute("aria-pressed", "true");
	}
);

test.each([
	{ label: "Projects", prefix: "+" },
	{ label: "Contexts", prefix: "@" },
])(
	"shows more and fewer $label while keeping the selected choice visible",
	async ({ label, prefix }) => {
		const manyItems = Array.from({ length: 7 }, (_, index) => ({
			...items[0],
			line_number: index + 1,
			projects: [`Value-${index}`],
			contexts: [`Value-${index}`],
		}));
		render(Harness, {
			desktop: adapter({
				restoreSession: async () => ({
					...initial,
					session: {
						...initialReadySession,
						todo_file: { ...initialReadySession.todo_file, items: manyItems },
					},
				}),
			}),
		});
		const last = page.getByRole("button", { name: `${prefix}Value-6`, exact: true });
		await expect.element(last).not.toBeInTheDocument();
		await page.getByRole("button", { name: `Show more ${label}` }).click();
		await expect.element(last).toBeVisible();
		await last.click();
		await page.getByRole("button", { name: `Show fewer ${label}` }).click();
		await expect.element(last).toHaveAttribute("aria-pressed", "true");
		await expect
			.element(page.getByRole("button", { name: `${prefix}Value-5`, exact: true }))
			.not.toBeInTheDocument();
		await expect.poll(rowCount).toBe(1);
	}
);

test("resets filters after a successful Workspace switch", async () => {
	render(Harness, {
		desktop: adapter({
			switchWorkspace: async () => ({ status: "applied", confirmed: secondWorkspaceSession }),
		}),
	});
	await page.getByRole("button", { name: "Show more Projects" }).click();
	await page.getByRole("button", { name: "Toggle Todo-item search" }).click();
	await page.getByRole("searchbox", { name: "Search Todo items" }).fill("work");
	await page.getByRole("button", { name: "+Work", exact: true }).click();
	await page.getByRole("button", { name: /^Completed/ }).click();
	await page.getByRole("button", { name: /Select workspace: Work/ }).click();
	await page.getByRole("menuitem", { name: "Review" }).click();
	await expect
		.element(page.getByRole("button", { name: /^All/ }))
		.toHaveAttribute("aria-pressed", "true");
	await expect
		.element(page.getByRole("button", { name: "Clear filters", exact: true }))
		.not.toBeInTheDocument();
	await expect.element(page.getByText("Review release", { exact: true })).toBeVisible();
	await expect.element(page.getByRole("searchbox", { name: "Search Todo items" })).toHaveValue("");
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
	await page.getByRole("button", { name: "Show more Projects" }).click();
	await page.getByRole("button", { name: "Toggle Todo-item search" }).click();
	await page.getByRole("searchbox", { name: "Search Todo items" }).fill("work");
	await page.getByRole("button", { name: "+Work", exact: true }).click();
	await page.getByRole("button", { name: /Select workspace: Work/ }).click();
	await page.getByRole("menuitem", { name: "Review" }).click();
	await expect
		.element(page.getByRole("button", { name: "+Work", exact: true }))
		.toHaveAttribute("aria-pressed", "true");
	await expect.element(page.getByText("Open work", { exact: true })).toBeVisible();
	await expect
		.element(page.getByRole("searchbox", { name: "Search Todo items" }))
		.toHaveValue("work");
});

test("updates the filtered view only after accepted completion", async () => {
	let finish!: (result: ReturnType<typeof confirmedTodo>) => void;
	render(Harness, {
		desktop: adapter({
			setTodoCompletion: () => new Promise((resolve) => (finish = resolve)),
		}),
	});
	await page.getByRole("button", { name: /^Open/ }).click();
	await page.getByRole("button", { name: "Show more Projects" }).click();
	await page.getByRole("button", { name: "+Work", exact: true }).click();
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
			...items.slice(1),
		])
	);
	await expect.element(page.getByText("Open work", { exact: true })).not.toBeInTheDocument();
	await expect
		.element(page.getByRole("button", { name: "+Work", exact: true }))
		.not.toBeInTheDocument();
	await expect
		.element(page.getByRole("button", { name: "Clear Project Work", exact: true }))
		.not.toBeInTheDocument();
	await expect.poll(rowCount).toBe(5);
});

test("preserves the filtered view after a rejected completion", async () => {
	render(Harness, {
		desktop: adapter({
			setTodoCompletion: async () => ({ status: "rejected", message: "Cannot complete" }),
		}),
	});
	await page.getByRole("button", { name: "Show more Projects" }).click();
	await page.getByRole("button", { name: "+Work", exact: true }).click();
	await page.getByRole("checkbox", { name: "Mark Open work complete" }).click();
	await expect.element(page.getByText("Open work", { exact: true })).toBeVisible();
});

test("keeps long filter input and facet labels inside a narrow independently scrolling sidebar", async () => {
	const longItems = Array.from({ length: 40 }, (_, index) => ({
		...items[0],
		line_number: index + 1,
		projects: [`Project-${String(index).padStart(2, "0")}-${"long-name-".repeat(20)}`],
	}));
	render(Harness, {
		desktop: adapter({
			restoreSession: async () => ({
				...initial,
				session: {
					...initialReadySession,
					todo_file: { ...initialReadySession.todo_file, items: longItems },
				},
			}),
		}),
	});
	const search = page.getByRole("searchbox", { name: "Find a filter" });
	await expect.element(search).toBeVisible();
	const input = search.element();
	input
		.closest<HTMLElement>('[data-slot="sidebar-wrapper"]')!
		.style.setProperty("--sidebar-width", "10rem");
	await search.fill("x".repeat(300));
	const inputBounds = input.getBoundingClientRect();
	const parentBounds = input.parentElement!.getBoundingClientRect();
	expect(inputBounds.left).toBeGreaterThanOrEqual(parentBounds.left);
	expect(inputBounds.right).toBeLessThanOrEqual(parentBounds.right);
	await page.getByRole("button", { name: "Clear filter search" }).click();
	await page.getByRole("button", { name: "Show more Projects" }).click();
	const viewport = page
		.getByLabelText("Sidebar filters")
		.element()
		.querySelector<HTMLElement>("[data-scroll-area-viewport]")!;
	await expect.poll(() => viewport.scrollHeight > viewport.clientHeight).toBe(true);
	expect(viewport.scrollWidth).toBe(viewport.clientWidth);
	const searchTop = input.getBoundingClientRect().top;
	viewport.scrollTop = viewport.scrollHeight;
	await expect.poll(() => viewport.scrollTop > 0).toBe(true);
	expect(input.getBoundingClientRect().top).toBe(searchTop);
	await expect.element(page.getByRole("button", { name: /^Open/ })).toBeVisible();
});

test("shows and clears the active Priority chip while preserving other filters", async () => {
	render(Harness, { desktop: adapter() });
	await page.getByRole("button", { name: /^Open/ }).click();
	await page.getByRole("button", { name: "@Home", exact: true }).click();
	await page.getByRole("button", { name: "Priority A", exact: true }).click();
	await expect
		.element(page.getByRole("button", { name: "Priority A", exact: true }))
		.toHaveAttribute("aria-pressed", "true");
	await expect.poll(rowCount).toBe(1);
	await page.getByRole("button", { name: "Clear Priority A", exact: true }).click();
	await expect
		.element(page.getByRole("button", { name: "Priority A", exact: true }))
		.toHaveAttribute("aria-pressed", "false");
	await expect.poll(rowCount).toBe(2);
	await expect
		.element(page.getByRole("button", { name: "Clear Context Home", exact: true }))
		.toBeVisible();
});

test("scopes choices and counts to the tab, retaining only available selections", async () => {
	const completedOnly = {
		...items[6],
		line_number: 8,
		projects: ["Finished"],
		contexts: ["Office"],
	};
	render(Harness, {
		desktop: adapter({
			restoreSession: async () => ({
				...initial,
				session: {
					...initialReadySession,
					todo_file: { ...initialReadySession.todo_file, items: [...items, completedOnly] },
				},
			}),
		}),
	});
	await page.getByRole("button", { name: /^Open/ }).click();
	await expect
		.element(page.getByRole("button", { name: "@Home", exact: true }))
		.toHaveTextContent("@Home 2");
	await expect
		.element(page.getByRole("button", { name: "+Finished", exact: true }))
		.not.toBeInTheDocument();
	await expect
		.element(page.getByRole("button", { name: "@Office", exact: true }))
		.not.toBeInTheDocument();
	await page.getByRole("button", { name: "+Personal", exact: true }).click();
	await page.getByRole("button", { name: "@Home", exact: true }).click();
	await expect.element(page.getByRole("button", { name: "@Away", exact: true })).toBeVisible();
	await page.getByRole("button", { name: /^Completed/ }).click();
	await expect
		.element(page.getByRole("button", { name: "Clear Project Personal", exact: true }))
		.not.toBeInTheDocument();
	await expect
		.element(page.getByRole("button", { name: "@Home", exact: true }))
		.toHaveAttribute("aria-pressed", "true");
	await expect
		.element(page.getByRole("button", { name: "@Home", exact: true }))
		.toHaveTextContent("@Home");
	await expect.element(page.getByRole("button", { name: "+Finished", exact: true })).toBeVisible();
	await expect
		.element(page.getByRole("button", { name: "+Personal", exact: true }))
		.not.toBeInTheDocument();
	await page.getByRole("button", { name: "@Office", exact: true }).click();
	await page.getByRole("button", { name: /^Open/ }).click();
	await expect
		.element(page.getByRole("button", { name: "Clear Context Office", exact: true }))
		.not.toBeInTheDocument();
	await expect.poll(rowCount).toBe(6);
});

test("reveals matching deferred items, keeps facets and totals, and restores Workspace preferences", async () => {
	const deferredItems: TodoFile["items"] = [
		{ ...items[0], metadata: { t: "9999-12-31", due: "2000-01-01" } },
		{ ...items[1], metadata: { t: "+2d" } },
		{ ...items[6], metadata: { t: "9999-12-31" } },
	];
	render(Harness, {
		desktop: adapter({
			restoreSession: async () => ({
				...initial,
				session: {
					...initialReadySession,
					todo_file: { ...initialReadySession.todo_file, items: deferredItems },
				},
			}),
			switchWorkspace: async () => ({ status: "applied", confirmed: secondWorkspaceSession }),
		}),
	});
	const toggle = page.getByRole("button", { name: "Show deferred", exact: true });
	await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
	await expect.element(toggle).toHaveTextContent("1");
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("2 matching items");
	await expect
		.element(page.getByRole("button", { name: "Invalid or unsupported Show from", exact: true }))
		.toBeVisible();
	await page.getByRole("button", { name: /^Open/ }).click();
	await expect
		.element(page.getByRole("button", { name: "+Work", exact: true }))
		.toHaveTextContent("+Work 1");
	await page.getByRole("button", { name: "Priority A", exact: true }).click();
	await expect
		.element(
			page.getByText("1 matching Todo item is deferred until a future Show from date.", {
				exact: true,
			})
		)
		.toBeVisible();
	await page
		.getByLabelText("No matching Todo items")
		.getByRole("button", { name: "Show deferred", exact: true })
		.click();
	await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
	await expect.element(page.getByText("Open work", { exact: true })).toBeVisible();
	await expect
		.element(page.getByTitle("Show from 9999-12-31 · Deferred", { exact: true }))
		.toBeVisible();
	await expect.element(page.getByTitle("Overdue · 2000-01-01", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: /^Completed/ }).click();
	await expect.element(toggle).toBeDisabled();
	await expect.element(toggle).toHaveTextContent("");
	await expect.element(page.getByText("Completed work", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: /^All/ }).click();
	await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
	await expect.element(page.getByLabelText("Active filters")).not.toBeInTheDocument();
	await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
	await page.getByRole("button", { name: /Select workspace: Work/ }).click();
	await page.getByRole("menuitem", { name: "Review" }).click();
	await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
});

test("threshold visibility refreshes at midnight and on return from inactivity without mutations", async () => {
	const datedItems: TodoFile["items"] = [
		{ ...items[0], metadata: { t: "2026-10-15" } },
		{ ...items[1], metadata: { t: "2026-10-16" } },
	];
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 14, 23, 59, 58));
	const desktop = adapter({
		restoreSession: async () => ({
			...initial,
			session: {
				...initialReadySession,
				todo_file: { ...initialReadySession.todo_file, items: datedItems },
			},
		}),
	});
	const create = vi.spyOn(desktop, "createTodo");
	const edit = vi.spyOn(desktop, "editTodo");
	const complete = vi.spyOn(desktop, "setTodoCompletion");
	const view = await render(Harness, { desktop });
	try {
		const toggle = page.getByRole("button", { name: "Show deferred", exact: true }).first();
		await expect.element(toggle).toHaveTextContent("2");
		await expect
			.element(page.getByLabelText("Filtered result count"))
			.toHaveTextContent("0 matching items");
		vi.setSystemTime(new Date(2026, 9, 15));
		await expect.element(page.getByText("Open work", { exact: true })).toBeVisible();
		await expect.element(toggle).toHaveTextContent("1");
		vi.setSystemTime(new Date(2026, 9, 16, 12));
		document.dispatchEvent(new Event("visibilitychange"));
		await expect.element(page.getByText("Open personal", { exact: true })).toBeVisible();
		await expect.element(toggle).toHaveTextContent("");
		vi.setSystemTime(new Date(2026, 9, 14, 12));
		window.dispatchEvent(new Event("focus"));
		await expect.element(toggle).toHaveTextContent("2");
		await expect
			.element(page.getByLabelText("Filtered result count"))
			.toHaveTextContent("0 matching items");
		expect(create).not.toHaveBeenCalled();
		expect(edit).not.toHaveBeenCalled();
		expect(complete).not.toHaveBeenCalled();
	} finally {
		view.unmount();
		vi.useRealTimers();
	}
});

test("uncompletion reapplies the threshold only after confirmation and locks the toggle while pending", async () => {
	const completedItem = { ...items[6], metadata: { t: "9999-12-31" } };
	let finish!: (result: ReturnType<typeof confirmedTodo>) => void;
	render(Harness, {
		desktop: adapter({
			restoreSession: async () => ({
				...initial,
				session: {
					...initialReadySession,
					todo_file: { ...initialReadySession.todo_file, items: [completedItem] },
				},
			}),
			setTodoCompletion: () => new Promise((resolve) => (finish = resolve)),
		}),
	});
	await page.getByRole("checkbox", { name: "Mark Completed work incomplete" }).click();
	const toggle = page.getByRole("button", { name: "Show deferred", exact: true });
	await expect.element(toggle).toBeDisabled();
	await expect.element(page.getByText("Completed work", { exact: true })).toBeVisible();
	finish(confirmedTodo([{ ...completedItem, completed: false, completion_date: null }]));
	await expect.element(page.getByText("Completed work", { exact: true })).not.toBeInTheDocument();
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("0 matching items");
	await page
		.getByLabelText("No matching Todo items")
		.getByRole("button", { name: "Show deferred", exact: true })
		.click();
	await expect.element(page.getByText("Completed work", { exact: true })).toBeVisible();
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
			restoreSession: async () => ({
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
