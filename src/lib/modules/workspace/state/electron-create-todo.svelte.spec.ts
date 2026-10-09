import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { ConfirmedSession, ConfirmedTodo, DesktopAPI } from "$lib/shared/desktop/contract";
import Harness, { type CreateTodoDesktop } from "./ElectronCreateTodoHarness.svelte";

const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const item = {
	line_number: 1,
	raw: "Existing +Home @Desk",
	completed: false,
	priority: null,
	creation_date: "2026-10-08",
	completion_date: null,
	description: "Existing",
	projects: ["Home"],
	contexts: ["Desk"],
	metadata: {},
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

function desktop(createTodo: CreateTodoDesktop["createTodo"]): CreateTodoDesktop {
	return {
		readSession: async () => initial,
		restoreSession: async () => initial,
		selectTodoFile: async () => null,
		createWorkspace: async () => ({ status: "rejected", message: "unused" }),
		switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
		deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
		setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
		deleteTodo: async () => ({ status: "rejected", message: "unused" }),
		createTodo,
	};
}

function confirmed(items: Array<typeof item> = []): ConfirmedTodo {
	return {
		scope,
		revision: 6,
		workspaceId,
		todo_file: { path: "/tmp/todo.txt", items, skipped: [] },
	};
}

test("create constructs its request from the confirmed active session and accepts the scoped file", async () => {
	let request: Parameters<CreateTodoDesktop["createTodo"]>[0] | undefined;
	let finish!: (outcome: Awaited<ReturnType<CreateTodoDesktop["createTodo"]>>) => void;
	render(Harness, {
		desktop: desktop((input) => {
			request = input;
			return new Promise((resolve) => {
				finish = resolve;
			});
		}),
	});

	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("ready");
	await page.getByRole("button", { name: "Create" }).click();
	await expect
		.element(page.getByLabelText("Pending operation"))
		.toHaveTextContent("create_todo_item");
	await expect.element(page.getByLabelText("Item count")).toHaveTextContent("1");
	expect(request).toEqual({
		scope,
		revision: 5,
		workspaceId,
		description: "Plan launch",
		projects: ["Work"],
		contexts: ["Office"],
	});
	await expect
		.element(page.getByLabelText("Pending target"))
		.toHaveTextContent(JSON.stringify({ workspaceId }));

	finish({ status: "applied", confirmed: confirmed([item, { ...item, line_number: 2 }]) });
	await expect.element(page.getByLabelText("Item count")).toHaveTextContent("2");
	await expect.element(page.getByLabelText("Pending operation")).toHaveTextContent("none");
});

test("create admission is synchronous and blocks a second create until the first settles", async () => {
	let attempts = 0;
	let finish!: (outcome: Awaited<ReturnType<CreateTodoDesktop["createTodo"]>>) => void;
	render(Harness, {
		desktop: desktop(() => {
			attempts++;
			return new Promise((resolve) => {
				finish = resolve;
			});
		}),
	});

	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("ready");
	const create = page.getByRole("button", { name: "Create" });
	const createButton = document.querySelector("button")!;
	createButton.click();
	createButton.click();
	await expect
		.element(page.getByLabelText("Pending operation"))
		.toHaveTextContent("create_todo_item");
	expect(attempts).toBe(1);
	finish({ status: "applied", confirmed: confirmed([item, { ...item, line_number: 2 }]) });
	await expect.element(page.getByLabelText("Item count")).toHaveTextContent("2");
});

test.each(["conflict", "rejected"] as const)(
	"create propagates %s and preserves or applies confirmed content",
	async (kind) => {
		render(Harness, {
			desktop: desktop(async () =>
				kind === "conflict"
					? { status: "conflict", message: "Changed on disk", confirmed: confirmed([]) }
					: { status: "rejected", message: "Cannot write" }
			),
		});
		await page.getByRole("button", { name: "Create" }).click();
		await expect
			.element(page.getByLabelText("Action result"))
			.toHaveTextContent(kind === "conflict" ? "Changed on disk" : "Cannot write");
		await expect
			.element(page.getByLabelText("Item count"))
			.toHaveTextContent(kind === "conflict" ? "0" : "1");
	}
);

test.each(["scope", "revision", "workspace"] as const)(
	"create result with stale %s cannot overwrite the confirmed Todo file",
	async (kind) => {
		const response = confirmed([]);
		if (kind === "scope") response.scope = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		if (kind === "revision") response.revision = 4;
		if (kind === "workspace") response.workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		render(Harness, {
			desktop: desktop(async () => ({ status: "applied", confirmed: response })),
		});
		await page.getByRole("button", { name: "Create" }).click();
		await expect.element(page.getByLabelText("Action result")).toHaveTextContent("Applied");
		await expect.element(page.getByLabelText("Item count")).toHaveTextContent("1");
	}
);
