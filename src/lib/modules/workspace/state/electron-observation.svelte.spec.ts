import { expect, test } from "vitest";
import {
	WorkspaceCommands as LoadedWorkspaceCommands,
	type WorkspaceLoadedData,
} from "./workspace-commands.svelte";
import { WorkspaceSessionFixture as WorkspaceCommands } from "./workspace-session-fixture.svelte";
import type { ConfirmedSession, DesktopAPI, TodoFileChange } from "$lib/shared/desktop/contract";

const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
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
		todo_file: { path: "/tmp/work.todo", items: [], skipped: [] },
	},
};
const changed: ConfirmedSession = {
	...initial,
	revision: 2,
	session: {
		status: "empty",
		catalogue:
			initial.session.status === "ready"
				? initial.session.catalogue
				: { version: 1, workspaces: [], active_workspace_id: null },
		warning: "Cannot open Todo file",
	},
};
function adapter(restore: DesktopAPI["restoreSession"]): DesktopAPI {
	return {
		restoreSession: restore,
		readSavedViews: async () => ({ status: "applied", views: [] }),
		saveView: async () => ({ status: "rejected", message: "unused" }),
		deleteView: async () => ({ status: "rejected", message: "unused" }),
		readSession: async () => initial,
		readWorkspace: async () => ({ status: "rejected", message: "unused" }),
		writeClipboardText: async () => null,
		selectTodoFile: async () => null,
		createWorkspace: async () => ({ status: "rejected", message: "unused" }),
		switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
		deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
		setWorkspaceSortOrder: async () => ({ status: "rejected", message: "unused" }),
		setWorkspaceShowDeferred: async () => ({ status: "rejected", message: "unused" }),
		undoTodo: async () => ({ status: "rejected", message: "unused" }),
		setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
		bulkDeleteTodos: async () => ({ status: "rejected", message: "unused" }),
		bulkSetTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
		editTodo: async () => ({ status: "rejected", message: "unused" }),
		deleteTodo: async () => ({ status: "rejected", message: "unused" }),
		createTodo: async () => ({ status: "rejected", message: "unused" }),
		reorderTodo: async () => ({ status: "rejected", message: "unused" }),
	};
}
const signal: TodoFileChange = { scope, revision: 1, workspaceId, todoPath: "/tmp/work.todo" };

test.each(["current", "not loaded", "stale", "stopped"])(
	"observation during command refresh reconsiders only the latest still-current event (%s)",
	async (kind) => {
		let backend = initial;
		let data: WorkspaceLoadedData = { confirmed: initial };
		let finish!: () => void;
		let restores = 0;
		let finishRestore!: () => void;
		let refreshes = 0;
		const session = new LoadedWorkspaceCommands(
			{
				...adapter(async () => {
					restores++;
					await new Promise<void>((resolve) => {
						finishRestore = resolve;
					});
					backend = { ...changed, revision: 3 };
					return backend;
				}),
				setWorkspaceShowDeferred: async () => {
					backend = { ...initial, revision: 2 };
					return { status: "applied", confirmed: backend };
				},
			},
			() => data,
			async () => {
				if (kind !== "not loaded") data = { confirmed: backend };
				if (++refreshes === 1)
					await new Promise<void>((resolve) => {
						finish = resolve;
					});
				data = { confirmed: backend };
			}
		);
		let notify!: (event: TodoFileChange) => void;
		const stop = session.observe(
			{
				onTodoFileChanged(listener) {
					notify = listener;
					return () => {};
				},
			},
			() => {}
		);
		const command = session.setShowDeferred(true);
		await expect.poll(() => !!finish).toBe(true);
		expect(session.isOperating).toBe(true);
		const event = { ...signal, revision: kind === "stale" ? 1 : 2 };
		notify(event);
		notify(event);
		if (kind === "stopped") stop();
		expect(restores).toBe(0);
		finish();
		await command;
		expect(restores).toBe(kind === "current" || kind === "not loaded" ? 1 : 0);
		if (kind === "current" || kind === "not loaded") {
			expect(session.isOperating).toBe(true);
			expect(await session.setShowDeferred(false)).toMatchObject({ status: "rejected" });
			finishRestore();
		}
		await expect.poll(() => session.isOperating).toBe(false);
		expect(session.session.status).toBe(
			kind === "current" || kind === "not loaded" ? "empty" : "ready"
		);
		stop();
	}
);

test("idle Todo-file observation reuses restoration and retains the catalogue on unreadable files", async () => {
	let loads = 0;
	const session = new WorkspaceCommands(adapter(async () => (loads++ ? changed : initial)));
	await session.initialize();
	let notify!: (event: TodoFileChange) => void;
	const notices: string[] = [];
	const stop = session.observe(
		{
			onTodoFileChanged(listener) {
				notify = listener;
				return () => {};
			},
		},
		() => notices.push("changed")
	);
	notify(signal);
	await expect.poll(() => session.session.status).toBe("empty");
	expect(session.warning).toBe("Cannot open Todo file");
	expect(session.catalogue?.active_workspace_id).toBe(workspaceId);
	expect(notices).toEqual([]);
	stop();
});

test("unchanged parsed summaries and stale signals produce no notice", async () => {
	let loads = 0;
	const session = new WorkspaceCommands(adapter(async () => ({ ...initial, revision: ++loads })));
	await session.initialize();
	let notify!: (event: TodoFileChange) => void;
	let notices = 0;
	let stopped = false;
	const stop = session.observe(
		{
			onTodoFileChanged(listener) {
				notify = listener;
				return () => {
					stopped = true;
				};
			},
		},
		() => notices++
	);
	for (const event of [
		{ ...signal, scope: "550e8400-e29b-41d4-a716-446655440002" },
		{ ...signal, workspaceId: "550e8400-e29b-41d4-a716-446655440002" },
		{ ...signal, todoPath: "/tmp/other.todo" },
		{ ...signal, revision: 0 },
	])
		notify(event);
	expect(loads).toBe(1);
	notify(signal);
	await expect.poll(() => session.isOperating).toBe(false);
	expect(loads).toBe(2);
	expect(notices).toBe(0);
	notify(signal);
	expect(loads).toBe(2);
	stop();
	expect(stopped).toBe(true);
	notify({ ...signal, revision: 2 });
	expect(loads).toBe(2);
});

test.each([
	"completion",
	"deletion",
	"creation",
	"reordering",
	"switch",
	"workspace creation",
	"workspace deletion",
])("observation signals during %s are reconsidered after command rejection", async (operation) => {
	let loads = 0;
	let finish!: () => void;
	const pending = () =>
		new Promise<{ status: "rejected"; message: string }>((resolve) => {
			finish = () => resolve({ status: "rejected", message: "Expected rejection" });
		});
	const item = {
		line_number: 1,
		raw: "Item",
		description: "Item",
		completed: false,
		priority: null,
		creation_date: null,
		completion_date: null,
		projects: [],
		contexts: [],
		metadata: {},

		edit: { description: "Item", metadata: [] },
	};
	const session = new WorkspaceCommands({
		...adapter(async () => {
			loads++;
			if (initial.session.status !== "ready") throw Error("Expected Ready fixture");
			return {
				...initial,
				session: {
					...initial.session,
					todo_file: { ...initial.session.todo_file, items: [item] },
				},
			};
		}),
		setWorkspaceSortOrder: async () => ({ status: "rejected", message: "unused" }),
		setWorkspaceShowDeferred: async () => ({ status: "rejected", message: "unused" }),
		undoTodo: async () => ({ status: "rejected", message: "unused" }),
		setTodoCompletion: pending,
		deleteTodo: pending,
		createTodo: pending,
		reorderTodo: pending,
		switchWorkspace: pending,
		createWorkspace: pending,
		deleteWorkspace: pending,
	});
	await session.initialize();
	let notify!: (event: TodoFileChange) => void;
	const stop = session.observe(
		{
			onTodoFileChanged(listener) {
				notify = listener;
				return () => {};
			},
		},
		() => {}
	);
	const action =
		operation === "completion"
			? session.setCompletion(item)
			: operation === "deletion"
				? session.deleteTodo(item)
				: operation === "creation"
					? session.createTodo({ description: "Item", projects: [], contexts: [] })
					: operation === "reordering"
						? session.reorderTodo([item])
						: operation === "switch"
							? session.open(workspaceId)
							: operation === "workspace creation"
								? session.create({ name: "Work", color: "blue", todoPath: "/tmp/work.todo" })
								: session.deleteWorkspace(workspaceId);
	notify(signal);
	expect(loads).toBe(1);
	expect(session.isOperating).toBe(true);
	finish();
	await action;
	await expect.poll(() => session.isOperating).toBe(false);
	expect(session.session.status).toBe("ready");
	expect(loads).toBe(2);
	stop();
});
