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
		reorderTodo: async () => ({ status: "rejected", message: "unused" }),
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
	await page.getByRole("button", { name: "+Work", exact: true }).click();
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
	await page.getByRole("button", { name: "Show more Projects" }).click();
	await page.getByRole("button", { name: "+Work", exact: true }).click();
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
