import { page } from "vitest/browser";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import type { ConfirmedSession, DesktopAPI, TodoFile } from "$lib/shared/desktop/contract";
import Harness from "./WorkspaceFilteringHarness.svelte";
import "../../../../routes/layout.css";

const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
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
			],
		},
		todo_file: { path: "/tmp/work.todo", items, skipped: [] },
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
	const search = page.getByRole("searchbox", { name: "Search Projects" });
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
