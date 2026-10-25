import { expect, test } from "vitest";
import { createDesktopClient, type ConfirmedSession, type SavedView } from "@tuxedo/contracts";
import { WorkspaceCommands } from "./workspace-commands.svelte";
import { SavedViewsResource } from "./saved-views-resource.svelte";

const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const filters = {
	status: "open",
	search: "",
	project: null,
	context: null,
	priority: null,
	due: null,
} as const;
const view: SavedView = {
	id: "550e8400-e29b-41d4-a716-446655440002",
	workspace_id: workspaceId,
	name: "Work",
	filters,
};
const current: ConfirmedSession = {
	scope: "9426bd98-a6dd-48eb-b1ab-037d82983ae1",
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
		todo_file: { path: "/tmp/todo.txt", items: [], skipped: [] },
	},
};
function fixture(invoke: (channel: string, request: unknown) => Promise<unknown>) {
	const calls: string[] = [];
	const desktop = createDesktopClient(async (channel, request) => {
		calls.push(channel);
		return channel === "tuxedo:read-session" ? current : invoke(channel, request);
	});
	const workspace = new WorkspaceCommands(desktop, {
		destination: () => workspaceId,
		navigating: () => false,
		navigate: async () => {},
	});
	return {
		desktop,
		workspace,
		views: new SavedViewsResource(desktop, workspace),
		calls,
		start: async () =>
			workspace.acceptLoadedSession({ value: await desktop.readSession({}), error: "" }),
	};
}

test("a saved-view command holds admission through its response and publishes it without another read", async () => {
	let release!: () => void;
	const response = new Promise<void>((resolve) => {
		release = resolve;
	});
	let entered!: () => void;
	const admitted = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const f = fixture(async (channel) => {
		if (channel === "tuxedo:read-saved-views") return { status: "applied", workspaceId, views: [] };
		if (channel === "tuxedo:save-view") {
			entered();
			await response;
			return { status: "applied", workspaceId, views: [view] };
		}
		throw Error(`Unexpected ${channel}`);
	});
	await f.start();
	const loaded = await f.desktop.readSavedViews({ workspaceId });
	f.views.acceptLoaded(workspaceId, loaded);
	const saving = f.views.save(view.name, filters);
	await admitted;
	expect(f.views.views).toEqual([]);
	expect(f.workspace.isOperating).toBe(true);
	expect(
		await f.workspace.createTodo({ description: "Blocked", projects: [], contexts: [] })
	).toMatchObject({ status: "rejected" });
	release();
	expect(await saving).toEqual({ status: "applied" });
	expect(f.views.views).toEqual([view]);
	expect(f.views.canWrite).toBe(true);
	f.views.acceptLoaded(workspaceId, loaded);
	expect(f.views.views).toEqual([view]);
	expect(f.calls).toEqual(["tuxedo:read-session", "tuxedo:read-saved-views", "tuxedo:save-view"]);
});

test("failed saved-view reads retain their views independently of Todo readiness, and Retry only reads", async () => {
	let fail = false;
	const f = fixture(async (channel) => {
		if (channel === "tuxedo:read-saved-views") {
			if (fail) throw Error("Saved views unavailable");
			return { status: "applied", workspaceId, views: [view] };
		}
		throw Error(`Unexpected ${channel}`);
	});
	await f.start();
	await f.views.load(workspaceId);
	fail = true;
	expect(await f.views.load(workspaceId)).toEqual({
		status: "rejected",
		message: "Saved views unavailable",
	});
	expect(f.views.views).toEqual([view]);
	expect(f.views.canWrite).toBe(false);
	expect(f.workspace.canMutate).toBe(true);
	f.views.acceptLoaded(workspaceId, { status: "applied", workspaceId, views: [view] });
	expect(f.views.error).toBe("");
	expect(f.views.canWrite).toBe(true);
	f.views.acceptLoaded(workspaceId, {
		status: "rejected",
		message: "Fresh navigation read failed",
	});
	expect(f.views.views).toEqual([view]);
	expect(f.views.error).toBe("Fresh navigation read failed");
	fail = false;
	expect(await f.views.retry()).toEqual({ status: "applied" });
	expect(f.views.canWrite).toBe(true);
	expect(f.calls).toEqual([
		"tuxedo:read-session",
		"tuxedo:read-saved-views",
		"tuxedo:read-saved-views",
		"tuxedo:read-saved-views",
	]);
});

test("an older saved-view read cannot overwrite a newer read", async () => {
	let resolve!: (value: unknown) => void;
	const older = new Promise<unknown>((done) => {
		resolve = done;
	});
	let reads = 0;
	const f = fixture(async () =>
		++reads === 1 ? older : { status: "applied", workspaceId, views: [view] }
	);
	await f.start();
	const pending = f.views.load(workspaceId);
	await f.views.load(workspaceId);
	resolve({ status: "applied", workspaceId, views: [] });
	await pending;
	expect(f.views.views).toEqual([view]);
	expect(f.views.canWrite).toBe(true);
});
