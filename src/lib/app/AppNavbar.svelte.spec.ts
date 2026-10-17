import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { detectPlatform } from "@tanstack/svelte-hotkeys";
import {
	createDesktopClient,
	undoTodoRequestSchema,
	type ConfirmedSession,
	type DesktopAPI,
	type DesktopRequest,
} from "$lib/shared/desktop/contract";
import Harness from "./UndoHarness.svelte";

const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
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
					created_at: "2026-10-15T00:00:00Z",
				},
			],
		},
		todo_file: { path: "/tmp/work.todo", items: [], skipped: [] },
	},
};
if (initial.session.status !== "ready") throw Error("Invalid fixture");
const todo_file = initial.session.todo_file;
const created = {
	scope,
	revision: 2,
	workspaceId,
	undoLabel: "Undo creation" as const,
	todo_file: {
		...todo_file,
		items: [
			{
				line_number: 1,
				raw: "New",
				completed: false,
				priority: null,
				creation_date: null,
				completion_date: null,
				description: "New",
				projects: [],
				contexts: [],
				metadata: {},
				edit: { description: "New", metadata: [] },
			},
		],
	},
};

function adapter(undo: DesktopAPI["undoTodo"]): DesktopAPI {
	return createDesktopClient(async (channel, input) => {
		if (channel === "tuxedo:restore-session") return initial;
		if (channel === "tuxedo:read-saved-views") return { status: "applied", views: [] };
		if (channel === "tuxedo:create-todo") return { status: "applied", confirmed: created };
		if (channel === "tuxedo:undo-todo") return undo(undoTodoRequestSchema.parse(input));
		throw Error(`Unexpected ${channel}`);
	});
}

test("Home/recovery cannot undo or open Todo-item creation despite a retained ready session", async () => {
	let calls = 0;
	render(Harness, {
		readerAvailable: false,
		desktop: adapter(async () => {
			calls++;
			return { status: "applied", confirmed: { scope, revision: 3, workspaceId, todo_file } };
		}),
	});
	await page.getByRole("button", { name: "Create item" }).click();
	await expect
		.element(page.getByRole("button", { name: "Undo creation", exact: true }))
		.toBeDisabled();
	await page.getByRole("textbox", { name: "Draft" }).element().blur();
	const modifier = detectPlatform() === "mac" ? "Meta" : "Control";
	await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`);
	await userEvent.keyboard(`{${modifier}>}n{/${modifier}}`);
	expect(calls).toBe(0);
	await expect.element(page.getByLabelText("Creation open")).toHaveTextContent("false");
});

test("topbar Undo follows confirmed data, blocks overlapping actions, and consumes its slot", async () => {
	let finish!: (value: Awaited<ReturnType<DesktopAPI["undoTodo"]>>) => void;
	let request: DesktopRequest<"undoTodo"> | undefined;
	render(Harness, {
		desktop: adapter((input) => {
			request = input;
			return new Promise((resolve) => {
				finish = resolve;
			});
		}),
	});
	await expect
		.element(page.getByRole("button", { name: "Undo last change", exact: true }))
		.toBeDisabled();
	await page.getByRole("button", { name: "Create item" }).click();
	await expect
		.element(page.getByRole("button", { name: "Undo creation", exact: true }))
		.toBeEnabled();
	await page.getByRole("button", { name: "Undo creation", exact: true }).click();
	await expect
		.element(page.getByRole("button", { name: "Undo creation", exact: true }))
		.toBeDisabled();
	await expect.element(page.getByLabelText("Item count")).toHaveTextContent("1");
	expect(request).toEqual({ scope, revision: 2, workspaceId });
	finish({ status: "applied", confirmed: { scope, revision: 3, workspaceId, todo_file } });
	await expect.element(page.getByLabelText("Item count")).toHaveTextContent("0");
	await expect
		.element(page.getByRole("button", { name: "Undo last change", exact: true }))
		.toBeDisabled();
});

test("Undo shortcut leaves text inputs alone and works outside them", async () => {
	let calls = 0;
	render(Harness, {
		desktop: adapter(async () => {
			calls++;
			return { status: "applied", confirmed: { scope, revision: 3, workspaceId, todo_file } };
		}),
	});
	await page.getByRole("button", { name: "Create item" }).click();
	await expect
		.element(page.getByRole("button", { name: "Undo creation", exact: true }))
		.toBeEnabled();
	await page.getByRole("textbox", { name: "Draft" }).click();
	const hotkey = detectPlatform() === "mac" ? "{Meta>}z{/Meta}" : "{Control>}z{/Control}";
	await userEvent.keyboard(hotkey);
	expect(calls).toBe(0);
	await page.getByRole("button", { name: "Undo creation", exact: true }).element().focus();
	await userEvent.keyboard(hotkey);
	await expect.poll(() => calls).toBe(1);
	await expect
		.element(page.getByRole("button", { name: "Undo last change", exact: true }))
		.toBeDisabled();
});

test("Undo failures retain the button; conflicts clear it and report the reason", async () => {
	let calls = 0;
	render(Harness, {
		desktop: adapter(async () =>
			++calls === 1
				? { status: "rejected", message: "Cannot undo: write denied" }
				: {
						status: "conflict",
						message: "The Todo file changed on disk.",
						confirmed: { scope, revision: 3, workspaceId, todo_file },
					}
		),
	});
	await page.getByRole("button", { name: "Create item" }).click();
	await page.getByRole("button", { name: "Undo creation", exact: true }).click();
	await expect.element(page.getByText("Cannot undo: write denied")).toBeVisible();
	await expect
		.element(page.getByRole("button", { name: "Undo creation", exact: true }))
		.toBeEnabled();
	await page.getByRole("button", { name: "Undo creation", exact: true }).click();
	await expect.element(page.getByText("The Todo file changed on disk.")).toBeVisible();
	await expect
		.element(page.getByRole("button", { name: "Undo last change", exact: true }))
		.toBeDisabled();
});
