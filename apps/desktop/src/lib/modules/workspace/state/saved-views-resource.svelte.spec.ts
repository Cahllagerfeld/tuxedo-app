import { expect, test } from "vitest";
import { createDesktopClient, type ConfirmedSession, type SavedView } from "@tuxedo/contracts";
import { WorkspaceCommands } from "./workspace-commands.svelte";
import { SavedViewsResource } from "./saved-views-resource.svelte";
import { readSavedViews, type SavedViewsData } from "./workspace-route-data";
import type { DisplayedDataTarget } from "./invalidate-displayed-data";

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
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function fixture(invoke: (channel: string, request: unknown) => Promise<unknown>) {
	const desktop = createDesktopClient(invoke);
	let data: SavedViewsData | undefined;
	let refreshStep: (() => Promise<void>) | undefined;
	const invalidations: DisplayedDataTarget[] = [];
	if (current.session.status !== "ready") throw Error("Expected Ready");
	const ready = current.session;
	const workspace = new WorkspaceCommands(desktop, {
		session: () => ({ value: current, error: "" }),
		workspace: () => ({
			workspaceId,
			error: "",
			value: {
				status: "ready",
				workspace: ready.catalogue.workspaces[0],
				todo_file: ready.todo_file,
				confirmation: { scope: current.scope, revision: current.revision },
			},
		}),
		destination: () => workspaceId,
		navigating: () => false,
		invalidate: async (target) => {
			invalidations.push(target);
		},
	});
	const load = async () => {
		await refreshStep?.();
		data = await readSavedViews(desktop, workspaceId, () => data);
	};
	const views = new SavedViewsResource(desktop, workspace, {
		workspaceId: () => workspaceId,
		current: () => data,
		invalidate: async (target) => {
			invalidations.push(target);
			if (target.savedViewsId === workspaceId) await load();
		},
	});
	return {
		workspace,
		views,
		load,
		invalidations,
		setRefreshStep: (step: () => Promise<void>) => {
			refreshStep = step;
		},
	};
}

test("a saved-view write invalidates only its saved-view loader and holds admission until that read completes", async () => {
	const entered = deferred();
	const read = deferred();
	let persisted: readonly SavedView[] = [];
	const f = fixture(async (channel) => {
		if (channel === "tuxedo:read-saved-views")
			return { status: "applied", workspaceId, views: persisted };
		if (channel === "tuxedo:save-view") {
			persisted = [view];
			return { status: "applied", workspaceId, views: [] };
		}
		throw Error("Unexpected operation");
	});
	await f.load();
	f.setRefreshStep(async () => {
		entered.resolve();
		await read.promise;
	});
	const saving = f.views.save(view.name, filters);
	await entered.promise;
	expect(f.views.views).toEqual([]);
	expect(f.workspace.isOperating).toBe(true);
	expect(
		await f.workspace.createTodo({ description: "Blocked", projects: [], contexts: [] })
	).toMatchObject({ status: "rejected" });
	read.resolve();
	expect(await saving).toEqual({ status: "applied" });
	expect(f.views.views).toEqual([view]);
	expect(f.views.canWrite).toBe(true);
	expect(f.invalidations).toEqual([{ savedViewsId: workspaceId }]);
});

test("failed saved-view reads retain their views independently of Todo readiness, and Retry only reads", async () => {
	let fail = false;
	let writes = 0;
	const f = fixture(async (channel) => {
		if (channel === "tuxedo:read-saved-views") {
			if (fail) throw Error("Saved views unavailable");
			return { status: "applied", workspaceId, views: [view] };
		}
		writes++;
		throw Error("Unexpected write");
	});
	await f.load();
	fail = true;
	await f.load();
	expect(f.views.views).toEqual([view]);
	expect(f.views.error).toBe("Saved views unavailable");
	expect(f.views.canWrite).toBe(false);
	expect(f.workspace.canMutate).toBe(true);
	fail = false;
	expect(await f.views.retry()).toEqual({ status: "applied" });
	expect(f.views.canWrite).toBe(true);
	expect(writes).toBe(0);
	expect(f.invalidations).toEqual([{ savedViewsId: workspaceId }]);
});
