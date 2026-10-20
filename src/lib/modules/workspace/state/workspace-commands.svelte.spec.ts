import { expect, test } from "vitest";
import { WorkspaceCommands } from "./workspace-commands.svelte";
import { WorkspaceData } from "./workspace-data.svelte";
import {
	createWorkspaceQueryClient,
	workspaceQueryKeys,
	workspaceDestinationQuery,
	type WorkspaceDestination,
} from "./workspace-queries";
import { createDesktopClient, type ConfirmedSession } from "$lib/shared/desktop/contract";
import type { TodoItem } from "$lib/shared/desktop/todo";

const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const ready = (
	revision: number,
	show_deferred = false,
	items: TodoItem[] = []
): ConfirmedSession => ({
	scope,
	revision,
	undoLabel: "Undo creation",
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
					created_at: "2026-10-15T10:00:00Z",
					show_deferred,
				},
			],
		},
		todo_file: { path: "/tmp/work.todo", items, skipped: [] },
	},
});

function destination(confirmed: ConfirmedSession): WorkspaceDestination {
	const session = confirmed.session;
	if (session.status !== "ready") throw Error("Expected a Ready fixture");
	const workspace = session.catalogue.workspaces.find(
		(workspace) => workspace.id === session.catalogue.active_workspace_id
	);
	if (!workspace) throw Error("Expected an Active workspace fixture");
	return { status: "loaded", workspace, todo_file: session.todo_file };
}

function fixture(
	options: {
		read?: () => Promise<ConfirmedSession>;
		write?: () => Promise<unknown>;
		navigating?: () => boolean;
		workspaceId?: () => string | undefined;
	} = {}
) {
	const queryClient = createWorkspaceQueryClient();
	queryClient.setQueryData(workspaceQueryKeys.session, ready(1));
	queryClient.setQueryData(workspaceQueryKeys.views, []);
	const requests: string[] = [];
	const desktop = createDesktopClient(async (channel) => {
		requests.push(channel);
		if (channel === "tuxedo:read-session") return options.read ? options.read() : ready(2, true);
		if (channel === "tuxedo:read-workspace")
			return destination(options.read ? await options.read() : ready(2, true));
		if (channel === "tuxedo:restore-session") return ready(2, true);
		if (channel === "tuxedo:read-saved-views") return { status: "applied", views: [] };
		return options.write ? options.write() : { status: "applied", confirmed: ready(2, true) };
	});
	const data = new WorkspaceData(desktop, queryClient, options.workspaceId);
	const commands = new WorkspaceCommands(desktop, data, queryClient, options.navigating);
	return { queryClient, data, commands, requests };
}

test("confirmed reads come from the Query cache rather than mutation outcomes", async () => {
	const { data, commands, queryClient } = fixture({ read: async () => ready(2, false) });
	expect(await commands.setShowDeferred(true)).toEqual({ status: "applied" });
	expect(data.activeWorkspace?.show_deferred).toBe(false);
	queryClient.setQueryData(workspaceQueryKeys.session, ready(3, true));
	expect(data.activeWorkspace?.show_deferred).toBe(true);
	expect(data.undoLabel).toBe("Undo creation");
});

test("admission remains synchronous and closed until Query revalidation finishes", async () => {
	let finish!: (session: ConfirmedSession) => void;
	const { commands, data, requests } = fixture({
		read: () =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	});
	const saving = commands.setShowDeferred(true);
	expect(await commands.setShowDeferred(false)).toMatchObject({ status: "rejected" });
	await expect.poll(() => !!finish).toBe(true);
	expect(commands.isOperating).toBe(true);
	expect(commands.pendingOperation).toBe("set_workspace_show_deferred");
	expect(data.activeWorkspace?.show_deferred).toBe(false);
	expect(data.todoFile?.path).toBe("/tmp/work.todo");
	expect(await commands.open(workspaceId)).toMatchObject({ status: "rejected" });
	finish(ready(2, true));
	expect(await saving).toEqual({ status: "applied" });
	expect(commands.isOperating).toBe(false);
	expect(data.activeWorkspace?.show_deferred).toBe(true);
	expect(
		requests.filter((channel) => channel === "tuxedo:set-workspace-show-deferred")
	).toHaveLength(1);
});

test("navigation admission prevents mutations of the outgoing Workspace", async () => {
	const { commands, requests } = fixture({ navigating: () => true });
	expect(
		await commands.createTodo({ description: "Blocked", projects: [], contexts: [] })
	).toMatchObject({ status: "rejected" });
	expect(requests).toEqual([]);
});

test("a rejected mutation does not refetch or overwrite confirmed data", async () => {
	const { commands, data, requests } = fixture({
		write: async () => ({ status: "rejected", message: "Read-only catalogue" }),
	});
	expect(await commands.setShowDeferred(true)).toEqual({
		status: "rejected",
		message: "Read-only catalogue",
	});
	expect(data.activeWorkspace?.show_deferred).toBe(false);
	expect(requests).toEqual(["tuxedo:set-workspace-show-deferred"]);
});

test("a committed write followed by failed Query refresh keeps old data and is never retried", async () => {
	const { commands, data, requests } = fixture({
		read: async () => {
			throw Error("Read failed");
		},
	});
	expect(await commands.setShowDeferred(true)).toMatchObject({
		status: "applied",
		notice: expect.stringContaining("Change saved"),
	});
	expect(data.todoFile?.path).toBe("/tmp/work.todo");
	expect(data.activeWorkspace?.show_deferred).toBe(false);
	expect(data.error).toBe("Read failed");
	expect(commands.refreshError).toContain("could not refresh");
	expect(
		await commands.createTodo({ description: "No obsolete target", projects: [], contexts: [] })
	).toMatchObject({ status: "rejected" });
	expect(requests).toEqual(["tuxedo:set-workspace-show-deferred", "tuxedo:read-session"]);
});

test("a rejected transport write is never retried", async () => {
	const { commands, requests } = fixture({
		write: async () => {
			throw Error("Disconnected");
		},
	});
	expect(await commands.setShowDeferred(true)).toEqual({
		status: "rejected",
		message: "Disconnected",
	});
	expect(requests).toEqual(["tuxedo:set-workspace-show-deferred"]);
});

test("a conflict refetches backend confirmation before the next write", async () => {
	const { commands, data, requests } = fixture({
		write: async () => ({
			status: "conflict",
			message: "Changed on disk",
			confirmed: {
				scope,
				revision: 2,
				workspaceId,
				todo_file: { path: "/tmp/work.todo", items: [], skipped: [] },
			},
		}),
	});
	expect(await commands.createTodo({ description: "New", projects: [], contexts: [] })).toEqual({
		status: "conflict",
		message: "Changed on disk",
	});
	expect(data.confirmed?.revision).toBe(2);
	expect(data.activeWorkspace?.show_deferred).toBe(true);
	expect(requests).toEqual(["tuxedo:create-todo", "tuxedo:read-session"]);
});

test("creation remains saved when navigation fails after successful Query refresh", async () => {
	const { commands, requests } = fixture();
	expect(
		await commands.create({ name: "Work", color: "blue", todoPath: "/tmp/work.todo" }, async () => {
			throw Error("Destination unavailable");
		})
	).toMatchObject({
		status: "applied",
		workspaceId,
		notice: expect.stringContaining("Change saved"),
	});
	expect(
		await commands.createTodo({ description: "Blocked", projects: [], contexts: [] })
	).toMatchObject({ status: "rejected" });
	expect(requests.filter((channel) => channel === "tuxedo:create-workspace")).toHaveLength(1);
});

test.each(["completion", "deletion", "reordering"] as const)(
	"batch %s rejects stale Todo items before reaching IPC",
	async (operation) => {
		const todo: TodoItem = {
			line_number: 1,
			raw: "Current content",
			description: "Current content",
			completed: false,
			priority: null,
			creation_date: null,
			completion_date: null,
			projects: [],
			contexts: [],
			metadata: {},
			edit: { description: "Current content", metadata: [] },
		};
		const { commands, queryClient, requests } = fixture();
		queryClient.setQueryData(workspaceQueryKeys.session, ready(1, false, [todo]));
		for (const stale of [
			{ ...todo, raw: "Old content" },
			{ ...todo, line_number: 2 },
		]) {
			const result = await (operation === "completion"
				? commands.bulkSetCompletion([todo, stale], true)
				: operation === "deletion"
					? commands.bulkDeleteTodos([todo, stale])
					: commands.reorderTodo([todo, stale]));
			expect(result).toEqual({
				status: "rejected",
				message: "The Todo file changed. Try again with its current Todo items.",
			});
		}
		expect(requests).toEqual([]);
	}
);

test("subscribing to load-prefetched queries does not duplicate IPC reads", async () => {
	const { requests, data } = fixture();
	await Promise.resolve();
	expect(data.confirmed?.revision).toBe(1);
	expect(data.savedViews).toEqual([]);
	expect(requests).toEqual([]);
});

test("lifecycle refresh preserves the outgoing route query until navigation commits", async () => {
	const { commands, data, queryClient } = fixture({ workspaceId: () => workspaceId });
	queryClient.setQueryData(workspaceQueryKeys.destination(workspaceId), destination(ready(1)));
	expect(
		await commands.create({ name: "Work", color: "blue", todoPath: "/tmp/work.todo" })
	).toMatchObject({ status: "applied" });
	expect(queryClient.getQueryData<ConfirmedSession>(workspaceQueryKeys.session)?.revision).toBe(2);
	expect(data.confirmed?.revision).toBe(2);
	expect(data.todoFile).toEqual(destination(ready(1)).todo_file);
	expect(data.activeWorkspace?.show_deferred).toBe(true);
	expect(
		queryClient.getQueryState(workspaceQueryKeys.destination(workspaceId))?.isInvalidated
	).toBe(true);
});

test("an inactive destination preloads through a repeatable RPC without activating it", async () => {
	const otherId = "550e8400-e29b-41d4-a716-446655440001";
	const active = ready(1);
	const loaded = destination(active);
	const inactive: WorkspaceDestination = {
		...loaded,
		workspace: {
			...loaded.workspace,
			id: otherId,
			name: "Personal",
			todo_path: "/tmp/personal.todo",
		},
		todo_file: { ...loaded.todo_file, path: "/tmp/personal.todo" },
	};
	const requests: { channel: string; request: unknown }[] = [];
	const desktop = createDesktopClient(async (channel, request) => {
		requests.push({ channel, request });
		if (channel === "tuxedo:read-workspace") return inactive;
		throw Error("Preloading must not activate a Workspace");
	});
	const queryClient = createWorkspaceQueryClient();
	queryClient.setQueryData(workspaceQueryKeys.session, active);
	expect(await queryClient.query(workspaceDestinationQuery(desktop, otherId))).toEqual(inactive);
	expect(queryClient.getQueryData(workspaceQueryKeys.session)).toEqual(active);
	expect(requests).toEqual([
		{ channel: "tuxedo:read-workspace", request: { workspaceId: otherId } },
	]);
});

test("an unavailable destination rejects its query without replacing prior confirmed contents", async () => {
	const queryClient = createWorkspaceQueryClient();
	const prior = destination(ready(1));
	queryClient.setQueryData(workspaceQueryKeys.destination(workspaceId), prior);
	await queryClient.invalidateQueries({
		queryKey: workspaceQueryKeys.destinations,
		refetchType: "none",
	});
	const desktop = createDesktopClient(async () => ({
		status: "rejected",
		message: "Todo file unavailable",
	}));
	await expect(queryClient.query(workspaceDestinationQuery(desktop, workspaceId))).rejects.toThrow(
		"Todo file unavailable"
	);
	expect(queryClient.getQueryData(workspaceQueryKeys.destination(workspaceId))).toEqual(prior);
});

test("Home recovery invalidates prior destination confirmations before retrying navigation", async () => {
	const { commands, queryClient } = fixture();
	queryClient.setQueryData(workspaceQueryKeys.destination(workspaceId), destination(ready(1)));
	expect(await commands.restore()).toEqual({ status: "applied" });
	expect(
		queryClient.getQueryState(workspaceQueryKeys.destination(workspaceId))?.isInvalidated
	).toBe(true);
});

test("deleting an inactive Workspace refreshes the displayed destination catalogue", async () => {
	const otherId = "550e8400-e29b-41d4-a716-446655440001";
	const initial = ready(1);
	if (initial.session.status !== "ready") throw Error("Expected a Ready fixture");
	let current: ConfirmedSession = {
		...initial,
		session: {
			...initial.session,
			catalogue: {
				...initial.session.catalogue,
				workspaces: [
					...initial.session.catalogue.workspaces,
					{
						id: otherId,
						name: "Personal",
						color: "green",
						todo_path: "/tmp/personal.todo",
						created_at: "2026-10-15T10:00:00Z",
					},
				],
			},
		},
	};
	const desktop = createDesktopClient(async (channel) => {
		if (channel === "tuxedo:read-session") return current;
		if (channel === "tuxedo:read-workspace") return destination(current);
		if (channel === "tuxedo:delete-workspace") {
			current = ready(2);
			return { status: "applied", confirmed: current };
		}
		if (channel === "tuxedo:read-saved-views") return { status: "applied", views: [] };
		throw Error("Unexpected operation");
	});
	const queryClient = createWorkspaceQueryClient();
	queryClient.setQueryData(workspaceQueryKeys.session, current);
	queryClient.setQueryData(workspaceQueryKeys.views, []);
	await queryClient.query(workspaceDestinationQuery(desktop, workspaceId));
	const data = new WorkspaceData(desktop, queryClient, () => workspaceId);
	const commands = new WorkspaceCommands(desktop, data, queryClient);
	expect(data.catalogue?.workspaces.map((workspace) => workspace.id)).toEqual([
		workspaceId,
		otherId,
	]);
	expect(await commands.deleteWorkspace(otherId)).toEqual({ status: "applied" });
	expect(data.catalogue?.workspaces.map((workspace) => workspace.id)).toEqual([workspaceId]);
	expect(data.confirmed?.revision).toBe(2);
});

test("deleting the Active workspace recovers Home without refetching its removed destination", async () => {
	let current = ready(1);
	let routeId: string | undefined = workspaceId;
	const requests: string[] = [];
	const desktop = createDesktopClient(async (channel) => {
		requests.push(channel);
		if (channel === "tuxedo:read-session") return current;
		if (channel === "tuxedo:read-workspace") {
			return current.session.status === "ready"
				? destination(current)
				: { status: "rejected", message: "Workspace no longer exists" };
		}
		if (channel === "tuxedo:delete-workspace") {
			current = {
				scope,
				revision: 2,
				session: {
					status: "empty",
					warning: null,
					catalogue: { version: 1, active_workspace_id: null, workspaces: [] },
				},
			};
			return { status: "applied", confirmed: current };
		}
		if (channel === "tuxedo:read-saved-views") return { status: "applied", views: [] };
		throw Error("Unexpected operation");
	});
	const queryClient = createWorkspaceQueryClient();
	queryClient.setQueryData(workspaceQueryKeys.session, current);
	queryClient.setQueryData(workspaceQueryKeys.views, []);
	await queryClient.query(workspaceDestinationQuery(desktop, workspaceId));
	requests.length = 0;
	const data = new WorkspaceData(desktop, queryClient, () => routeId);
	const commands = new WorkspaceCommands(
		desktop,
		data,
		queryClient,
		() => false,
		async () => {
			if (data.session.status !== "ready") routeId = undefined;
		}
	);
	expect(await commands.deleteWorkspace(workspaceId)).toEqual({ status: "applied" });
	expect(routeId).toBeUndefined();
	expect(data.session.status).toBe("empty");
	expect(commands.refreshError).toBe("");
	expect(requests).not.toContain("tuxedo:read-workspace");
});
