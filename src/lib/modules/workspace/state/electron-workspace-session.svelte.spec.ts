import { expect, test } from "vitest";
import {
	ElectronWorkspaceSessionState,
	type WorkspaceLoadedData,
} from "./electron-workspace-session.svelte";
import { createDesktopClient, type ConfirmedSession } from "$lib/shared/desktop/contract";

const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const ready = (revision: number, show_deferred = false): ConfirmedSession => ({
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
		todo_file: { path: "/tmp/work.todo", items: [], skipped: [] },
	},
});

function fixture(
	refresh: (data: WorkspaceLoadedData) => Promise<WorkspaceLoadedData>,
	rejected = false
) {
	let data = $state.raw<WorkspaceLoadedData>({ confirmed: ready(1) });
	const requests: string[] = [];
	const session = new ElectronWorkspaceSessionState(
		createDesktopClient(async (channel) => {
			requests.push(channel);
			if (channel === "tuxedo:set-workspace-show-deferred")
				return rejected
					? { status: "rejected", message: "Read-only catalogue" }
					: { status: "applied", confirmed: ready(2, true) };
			throw Error("Unexpected operation");
		}),
		() => data,
		async () => {
			data = await refresh(data);
		}
	);
	return {
		session,
		requests,
		replace: (incoming: WorkspaceLoadedData) => {
			data = incoming;
		},
	};
}

test("confirmed data belongs to the load getter, not command outcomes", async () => {
	const { session, replace } = fixture(async (data) => data);
	expect(await session.setShowDeferred(true)).toEqual({ status: "applied" });
	expect(session.activeWorkspace?.show_deferred).toBe(false);
	replace({ confirmed: ready(2, true) });
	expect(session.activeWorkspace?.show_deferred).toBe(true);
	expect(session.undoLabel).toBe("Undo creation");
});

test("command admission and pending controls remain held through revalidation", async () => {
	let finish!: (data: WorkspaceLoadedData) => void;
	const { session, requests } = fixture(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			})
	);
	const saving = session.setShowDeferred(true);
	await expect.poll(() => !!finish).toBe(true);
	expect(session.isOperating).toBe(true);
	expect(session.todoFile?.path).toBe("/tmp/work.todo");
	expect(session.activeWorkspace?.show_deferred).toBe(false);
	expect(await session.open(workspaceId)).toMatchObject({ status: "rejected" });
	expect(await session.setShowDeferred(false)).toMatchObject({ status: "rejected" });
	expect(requests).toHaveLength(1);
	finish({ confirmed: ready(2, true) });
	expect(await saving).toEqual({ status: "applied" });
	expect(session.isOperating).toBe(false);
	expect(session.activeWorkspace?.show_deferred).toBe(true);
});

test("failed commands retain confirmed data without requesting refresh", async () => {
	let refreshes = 0;
	const { session } = fixture(async (data) => {
		refreshes++;
		return data;
	}, true);
	expect(await session.setShowDeferred(true)).toEqual({
		status: "rejected",
		message: "Read-only catalogue",
	});
	expect(refreshes).toBe(0);
	expect(session.activeWorkspace?.show_deferred).toBe(false);
	expect(session.todoFile?.path).toBe("/tmp/work.todo");
});

test("a conflict refreshes confirmed disk data before releasing command admission", async () => {
	let data = $state.raw<WorkspaceLoadedData>({ confirmed: ready(1) });
	let finish!: () => void;
	const revisions: number[] = [];
	const session = new ElectronWorkspaceSessionState(
		createDesktopClient(async (channel, request) => {
			if (channel !== "tuxedo:create-todo") throw Error("Unexpected operation");
			revisions.push((request as { revision: number }).revision);
			return {
				status: "conflict",
				message: "Changed on disk",
				confirmed: {
					scope,
					revision: 2,
					workspaceId,
					todo_file: { path: "/tmp/work.todo", items: [], skipped: [] },
				},
			};
		}),
		() => data,
		() =>
			new Promise((resolve) => {
				finish = () => {
					data = { confirmed: ready(2, true) };
					resolve();
				};
			})
	);
	const command = session.createTodo({ description: "New", projects: [], contexts: [] });
	await expect.poll(() => !!finish).toBe(true);
	expect(session.isOperating).toBe(true);
	expect(session.activeWorkspace?.show_deferred).toBe(false);
	finish();
	expect(await command).toEqual({ status: "conflict", message: "Changed on disk" });
	expect(session.activeWorkspace?.show_deferred).toBe(true);
	const next = session.createTodo({ description: "New", projects: [], contexts: [] });
	await expect.poll(() => revisions.length).toBe(2);
	finish();
	await next;
	expect(revisions).toEqual([1, 2]);
});

test.each(["throw", "loaded error"])(
	"a saved command with %s during refresh is not reported as unsaved or retried",
	async (failure) => {
		const { session, requests } = fixture(async () => {
			if (failure === "throw") throw Error("Read failed");
			return { error: "Read failed" };
		});
		expect(await session.setShowDeferred(true)).toMatchObject({
			status: "applied",
			notice: expect.stringContaining("Change saved"),
		});
		expect(requests).toHaveLength(1);
		expect(session.isOperating).toBe(false);
		expect(
			await session.createTodo({ description: "No stale write", projects: [], contexts: [] })
		).toMatchObject({ status: "rejected" });
		expect(requests).toHaveLength(1);
	}
);
