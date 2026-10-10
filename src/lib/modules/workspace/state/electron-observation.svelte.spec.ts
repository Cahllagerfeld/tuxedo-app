import { expect, test } from "vitest";
import { ElectronWorkspaceSessionState } from "./electron-workspace-session.svelte";
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
		readSession: async () => initial,
		selectTodoFile: async () => null,
		createWorkspace: async () => ({ status: "rejected", message: "unused" }),
		switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
		deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
		setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
		deleteTodo: async () => ({ status: "rejected", message: "unused" }),
		createTodo: async () => ({ status: "rejected", message: "unused" }),
	};
}
const signal: TodoFileChange = { scope, revision: 1, workspaceId, todoPath: "/tmp/work.todo" };

test("idle Todo-file observation reuses restoration and retains the catalogue on unreadable files", async () => {
	let loads = 0;
	const session = new ElectronWorkspaceSessionState(
		adapter(async () => (loads++ ? changed : initial))
	);
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
	const session = new ElectronWorkspaceSessionState(
		adapter(async () => ({ ...initial, revision: ++loads }))
	);
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
	"switch",
	"workspace creation",
	"workspace deletion",
])(
	"observation signals are dropped during %s without delaying the command result",
	async (operation) => {
		let loads = 0;
		let finish!: () => void;
		const pending = () =>
			new Promise<{ status: "rejected"; message: string }>((resolve) => {
				finish = () => resolve({ status: "rejected", message: "Expected rejection" });
			});
		const session = new ElectronWorkspaceSessionState({
			...adapter(async () => {
				loads++;
				return initial;
			}),
			setTodoCompletion: pending,
			deleteTodo: pending,
			createTodo: pending,
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
		};
		const action =
			operation === "completion"
				? session.setCompletion(item)
				: operation === "deletion"
					? session.deleteTodo(item)
					: operation === "creation"
						? session.createTodo({ description: "Item", projects: [], contexts: [] })
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
		expect(session.isOperating).toBe(false);
		expect(session.session.status).toBe("ready");
		expect(loads).toBe(1);
		stop();
	}
);
