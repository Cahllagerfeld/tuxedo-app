import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ElectronSessionHarness from "./ElectronSessionHarness.svelte";
import { ElectronWorkspaceSessionState } from "./electron-workspace-session.svelte";
import { createDesktopClient, type ConfirmedSession } from "$lib/shared/desktop/contract";
const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const confirmed = (revision: number, warning: string | null): ConfirmedSession => ({
	scope,
	revision,
	session: {
		status: "empty",
		catalogue: { version: 1, workspaces: [], active_workspace_id: null },
		warning,
	},
});
test.each(["applied", "rejected", "thrown"] as const)(
	"operation replies remain paired with their callers after an %s result",
	async (status) => {
		let finish!: () => void;
		let switches = 0;
		const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
		const session = new ElectronWorkspaceSessionState(
			createDesktopClient(async (channel) => {
				if (channel === "tuxedo:restore-session") return confirmed(1, "Initial");
				if (channel === "tuxedo:read-saved-views") return { status: "applied", views: [] };
				if (channel === "tuxedo:switch-workspace") {
					switches++;
					return new Promise((resolve, reject) => {
						finish = () => {
							if (status === "thrown") reject(Error("Transport failed"));
							else if (status === "rejected") resolve({ status, message: "Cannot switch" });
							else resolve({ status, confirmed: confirmed(2, "Switched") });
						};
					});
				}
				throw Error(`Unexpected operation: ${channel}`);
			})
		);
		await session.initialize();
		const opening = session.open(workspaceId);
		expect(session.pendingOperation).toBe("open_workspace");
		expect(session.pendingTarget).toEqual({ workspaceId });
		expect(await session.deleteWorkspace(workspaceId)).toEqual({
			status: "rejected",
			message: "A Workspace session operation is already running.",
		});
		expect(session.pendingOperation).toBe("open_workspace");
		expect(session.pendingTarget).toEqual({ workspaceId });
		expect(switches).toBe(1);
		finish();
		expect(await opening).toEqual(
			status === "applied"
				? { status: "applied" }
				: {
						status: "rejected",
						message: status === "thrown" ? "Transport failed" : "Cannot switch",
					}
		);
		expect(session.isOperating).toBe(false);
		expect(session.pendingTarget).toBeNull();
		expect(session.warning).toBe(status === "applied" ? "Switched" : "Initial");
		expect(await session.restore()).toEqual({ status: "applied" });
	}
);

test("restored data is visible while Saved views load and their failure does not fail initialization", async () => {
	let finish!: () => void;
	const session = new ElectronWorkspaceSessionState(
		createDesktopClient(async (channel) => {
			if (channel === "tuxedo:restore-session") return confirmed(1, "Restored");
			if (channel === "tuxedo:read-saved-views")
				return new Promise((_, reject) => {
					finish = () => reject(Error("Cannot read Saved views"));
				});
			throw Error(`Unexpected operation: ${channel}`);
		})
	);
	const initialization = session.initialize();
	await expect.poll(() => session.warning).toBe("Restored");
	// Confirmed session and operation lifecycle are independent.
	expect(session.isLoading).toBe(false);
	expect(session.pendingOperation).toBe("restore");
	finish();
	expect(await initialization).toEqual({ status: "applied" });
	expect(session.savedViewsError).toBe("Cannot read Saved views");
	expect(session.error).toBe("");
	expect(session.isOperating).toBe(false);
});

test("sort persistence holds confirmed preferences until success and serializes session actions", async () => {
	const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
	const ready = (sort_order: "file" | "due", revision: number): ConfirmedSession => ({
		scope,
		revision,
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
						sort_order,
					},
				],
			},
			todo_file: { path: "/tmp/work.todo", items: [], skipped: [] },
		},
	});
	let finish!: (result: unknown) => void;
	let forwarded: unknown;
	const session = new ElectronWorkspaceSessionState(
		createDesktopClient(async (channel, request) => {
			if (channel === "tuxedo:restore-session") return ready("file", 1);
			if (channel === "tuxedo:read-saved-views") return { status: "applied", views: [] };
			if (channel === "tuxedo:set-workspace-sort-order") {
				forwarded = request;
				return new Promise((resolve) => {
					finish = resolve;
				});
			}
			throw Error("Unexpected operation");
		})
	);
	await session.initialize();
	const saving = session.setSortOrder("due");
	expect(session.isOperating).toBe(true);
	expect(session.activeWorkspace?.sort_order).toBe("file");
	expect(await session.open(workspaceId)).toMatchObject({ status: "rejected" });
	finish({ status: "rejected", message: "Read-only catalogue" });
	expect(await saving).toMatchObject({ status: "rejected" });
	expect(session.activeWorkspace?.sort_order).toBe("file");
	const retry = session.setSortOrder("due");
	finish({ status: "applied", confirmed: ready("due", 2) });
	expect(await retry).toEqual({ status: "applied" });
	expect(forwarded).toEqual({ scope, revision: 1, workspaceId, sortOrder: "due" });
	expect(session.activeWorkspace?.sort_order).toBe("due");
	expect(session.isOperating).toBe(false);
});
test("Show deferred persistence holds confirmed preferences until success and serializes session actions", async () => {
	const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
	const ready = (show_deferred: boolean, revision: number): ConfirmedSession => ({
		scope,
		revision,
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
	let finish!: (result: unknown) => void;
	let forwarded: unknown;
	const session = new ElectronWorkspaceSessionState(
		createDesktopClient(async (channel, request) => {
			if (channel === "tuxedo:restore-session") return ready(false, 1);
			if (channel === "tuxedo:read-saved-views") return { status: "applied", views: [] };
			if (channel === "tuxedo:set-workspace-show-deferred") {
				forwarded = request;
				return new Promise((resolve) => {
					finish = resolve;
				});
			}
			throw Error("Unexpected operation");
		})
	);
	await session.initialize();
	const saving = session.setShowDeferred(true);
	expect(session.isOperating).toBe(true);
	expect(session.activeWorkspace?.show_deferred).toBe(false);
	expect(await session.open(workspaceId)).toMatchObject({ status: "rejected" });
	finish({ status: "rejected", message: "Read-only catalogue" });
	expect(await saving).toMatchObject({ status: "rejected" });
	expect(session.activeWorkspace?.show_deferred).toBe(false);
	const retry = session.setShowDeferred(true);
	finish({ status: "applied", confirmed: ready(true, 2) });
	expect(await retry).toEqual({ status: "applied" });
	expect(forwarded).toEqual({ scope, revision: 1, workspaceId, showDeferred: true });
	expect(session.activeWorkspace?.show_deferred).toBe(true);
	expect(session.isOperating).toBe(false);
});
test("initialization restores the session explicitly with one backend request", async () => {
	const requests: string[] = [];
	const session = new ElectronWorkspaceSessionState({
		readSavedViews: async () => ({ status: "applied", views: [] }),
		saveView: async () => ({ status: "rejected", message: "unused" }),
		deleteView: async () => ({ status: "rejected", message: "unused" }),
		readSession: async () => {
			requests.push("read");
			return confirmed(1, "Initial");
		},
		restoreSession: async () => {
			requests.push("restore");
			return requests.length === 1 ? confirmed(1, "Initial") : confirmed(2, "Refreshed");
		},
		setWorkspaceSortOrder: async () => ({ status: "rejected", message: "unused" }),
		setWorkspaceShowDeferred: async () => ({ status: "rejected", message: "unused" }),
		undoTodo: async () => ({ status: "rejected", message: "unused" }),
		setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
		editTodo: async () => ({ status: "rejected", message: "unused" }),
		deleteTodo: async () => ({ status: "rejected", message: "unused" }),
		reorderTodo: async () => ({ status: "rejected", message: "unused" }),
		createTodo: async () => ({ status: "rejected", message: "unused" }),
		switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
		writeClipboardText: async () => null,
		selectTodoFile: async () => null,
		deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
		createWorkspace: async () => ({ status: "rejected", message: "unused" }),
	});
	expect(requests).toEqual([]);
	expect(session.isLoading).toBe(true);
	await session.initialize();
	expect(requests).toEqual(["restore"]);
	expect(session.warning).toBe("Initial");
	await session.restore();
	expect(requests).toEqual(["restore", "restore"]);
	expect(session.warning).toBe("Refreshed");
});
test("Todo operations without a loaded file reject before IPC and release admission", async () => {
	const unexpected = async () => {
		throw Error("Unexpected desktop operation");
	};
	const session = new ElectronWorkspaceSessionState({
		readSavedViews: async () => ({ status: "applied", views: [] }),
		saveView: async () => ({ status: "rejected", message: "unused" }),
		deleteView: async () => ({ status: "rejected", message: "unused" }),
		readSession: unexpected,
		restoreSession: async () => confirmed(1, null),
		setWorkspaceSortOrder: async () => ({ status: "rejected", message: "unused" }),
		setWorkspaceShowDeferred: async () => ({ status: "rejected", message: "unused" }),
		undoTodo: async () => ({ status: "rejected", message: "unused" }),
		setTodoCompletion: unexpected,
		editTodo: unexpected,
		deleteTodo: unexpected,
		reorderTodo: unexpected,
		createTodo: unexpected,
		switchWorkspace: unexpected,
		writeClipboardText: unexpected,
		selectTodoFile: unexpected,
		deleteWorkspace: unexpected,
		createWorkspace: unexpected,
	});
	await session.initialize();
	const todo = {
		line_number: 1,
		raw: "Existing",
		description: "Existing",
		edit: { description: "Existing", metadata: [] },
		completed: false,
		priority: null,
		creation_date: null,
		completion_date: null,
		projects: [],
		contexts: [],
		metadata: {},
	};
	for (const action of [
		() => session.setCompletion(todo),
		() => session.editTodo(todo, { description: "Edited", projects: [], contexts: [] }),
		() => session.deleteTodo(todo),
		() => session.reorderTodo([todo]),
		() => session.createTodo({ description: "New", projects: [], contexts: [] }),
	]) {
		expect(await action()).toEqual({
			status: "rejected",
			message: "No Active workspace Todo file is loaded.",
		});
		expect(session.pendingOperation).toBeNull();
		expect(session.pendingTarget).toBeNull();
	}
});
test.each(["success", "transport failure"])(
	"initialization blocks overlapping operations and releases admission after %s",
	async (result) => {
		let finish!: () => void;
		let restores = 0;
		const session = new ElectronWorkspaceSessionState({
			readSavedViews: async () => ({ status: "applied", views: [] }),
			saveView: async () => ({ status: "rejected", message: "unused" }),
			deleteView: async () => ({ status: "rejected", message: "unused" }),
			readSession: async () => confirmed(1, "Unused"),
			restoreSession: () => {
				if (restores++ > 0) return Promise.resolve(confirmed(2, "Restored"));
				return new Promise((resolve, reject) => {
					finish = () =>
						result === "success"
							? resolve(confirmed(1, "Initial"))
							: reject(Error("Could not load session"));
				});
			},
			setWorkspaceSortOrder: async () => ({ status: "rejected", message: "unused" }),
			setWorkspaceShowDeferred: async () => ({ status: "rejected", message: "unused" }),
			undoTodo: async () => ({ status: "rejected", message: "unused" }),
			setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
			editTodo: async () => ({ status: "rejected", message: "unused" }),
			deleteTodo: async () => ({ status: "rejected", message: "unused" }),
			reorderTodo: async () => ({ status: "rejected", message: "unused" }),
			createTodo: async () => ({ status: "rejected", message: "unused" }),
			switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
			writeClipboardText: async () => null,
			selectTodoFile: async () => null,
			deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
			createWorkspace: async () => ({ status: "rejected", message: "unused" }),
		});
		const initialization = session.initialize();
		expect(session.initialize()).toBe(initialization);
		expect(session.pendingOperation).toBe("restore");
		expect(await session.restore()).toMatchObject({ status: "rejected" });
		expect(await session.open("550e8400-e29b-41d4-a716-446655440000")).toMatchObject({
			status: "rejected",
		});
		expect(restores).toBe(1);
		finish();
		await initialization;
		expect(session.isOperating).toBe(false);
		expect(session.error).toBe(result === "success" ? "" : "Could not load session");
		await session.initialize();
		expect(restores).toBe(1);
		await session.restore();
		expect(restores).toBe(2);
		expect(session.error).toBe("");
		expect(session.warning).toBe("Restored");
	}
);
test("confirmed restoration rejects older results and exposes pending lifecycle state", async () => {
	let finish!: (value: ConfirmedSession) => void;
	let restores = 0;
	render(ElectronSessionHarness, {
		desktop: {
			setWorkspaceSortOrder: async () => ({ status: "rejected", message: "unused" }),
			setWorkspaceShowDeferred: async () => ({ status: "rejected", message: "unused" }),
			undoTodo: async () => ({ status: "rejected", message: "unused" }),
			setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
			editTodo: async () => ({ status: "rejected", message: "unused" }),
			deleteTodo: async () => ({ status: "rejected", message: "unused" }),
			reorderTodo: async () => ({ status: "rejected", message: "unused" }),
			createTodo: async () => ({ status: "rejected", message: "unused" }),
			switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
			writeClipboardText: async () => null,
			selectTodoFile: async () => null,
			deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
			createWorkspace: async () => ({ status: "rejected", message: "unused" }),
			readSavedViews: async () => ({ status: "applied", views: [] }),
			saveView: async () => ({ status: "rejected", message: "unused" }),
			deleteView: async () => ({ status: "rejected", message: "unused" }),
			readSession: async () => confirmed(5, "Confirmed"),
			restoreSession: () => {
				if (restores++ === 0) return Promise.resolve(confirmed(5, "Confirmed"));
				return new Promise((resolve) => {
					finish = resolve;
				});
			},
		},
	});
	await expect.element(page.getByLabelText("Session warning")).toHaveTextContent("Confirmed");
	await page.getByRole("button", { name: "Restore" }).click();
	await expect.element(page.getByLabelText("Pending operation")).toHaveTextContent("restore");
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("empty");
	finish(confirmed(4, "Stale"));
	await expect.element(page.getByLabelText("Pending operation")).toHaveTextContent("none");
	await expect.element(page.getByLabelText("Session warning")).toHaveTextContent("Confirmed");
});
test("creation keeps the confirmed summary while pending and applies a coherent Ready session", async () => {
	let finish!: (
		value: Awaited<ReturnType<import("$lib/shared/desktop/contract").DesktopAPI["createWorkspace"]>>
	) => void;
	const workspace = {
		id: "550e8400-e29b-41d4-a716-446655440000",
		name: "Personal",
		color: "blue" as const,
		todo_path: "/tmp/todo.txt",
		created_at: "2026-07-10T10:00:00Z",
	};
	render(ElectronSessionHarness, {
		desktop: {
			setWorkspaceSortOrder: async () => ({ status: "rejected", message: "unused" }),
			setWorkspaceShowDeferred: async () => ({ status: "rejected", message: "unused" }),
			undoTodo: async () => ({ status: "rejected", message: "unused" }),
			setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
			editTodo: async () => ({ status: "rejected", message: "unused" }),
			deleteTodo: async () => ({ status: "rejected", message: "unused" }),
			reorderTodo: async () => ({ status: "rejected", message: "unused" }),
			createTodo: async () => ({ status: "rejected", message: "unused" }),
			readSavedViews: async () => ({ status: "applied", views: [] }),
			saveView: async () => ({ status: "rejected", message: "unused" }),
			deleteView: async () => ({ status: "rejected", message: "unused" }),
			readSession: async () => confirmed(1, null),
			restoreSession: async () => confirmed(1, null),
			switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
			writeClipboardText: async () => null,
			selectTodoFile: async () => null,
			deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
			createWorkspace: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		},
	});
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("empty");
	await page.getByRole("button", { name: "Create" }).click();
	await expect
		.element(page.getByLabelText("Pending operation"))
		.toHaveTextContent("create_workspace");
	await expect.element(page.getByLabelText("Item count")).toHaveTextContent("0");
	finish({
		status: "applied",
		confirmed: {
			scope,
			revision: 2,
			session: {
				status: "ready",
				catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
				todo_file: {
					path: workspace.todo_path,
					items: [
						{
							line_number: 1,
							raw: "Call Mom +Family",
							completed: false,
							priority: null,
							creation_date: null,
							completion_date: null,
							description: "Call Mom",
							projects: ["Family"],
							contexts: [],
							metadata: {},

							edit: { description: "Call Mom", metadata: [] },
						},
					],
					skipped: [],
				},
			},
		},
	});
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("ready");
	await expect.element(page.getByLabelText("Item count")).toHaveTextContent("1");
	await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("Personal");
});
test("rejected creation preserves the current confirmed file and summary", async () => {
	const initial: ConfirmedSession = {
		scope,
		revision: 4,
		session: {
			status: "ready",
			catalogue: {
				version: 1,
				active_workspace_id: "550e8400-e29b-41d4-a716-446655440000",
				workspaces: [
					{
						id: "550e8400-e29b-41d4-a716-446655440000",
						name: "Existing",
						color: "blue",
						todo_path: "/tmp/existing.todo",
						created_at: "2026-07-10T10:00:00Z",
					},
				],
			},
			todo_file: { path: "/tmp/existing.todo", items: [], skipped: [] },
		},
	};
	render(ElectronSessionHarness, {
		desktop: {
			setWorkspaceSortOrder: async () => ({ status: "rejected", message: "unused" }),
			setWorkspaceShowDeferred: async () => ({ status: "rejected", message: "unused" }),
			undoTodo: async () => ({ status: "rejected", message: "unused" }),
			setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
			editTodo: async () => ({ status: "rejected", message: "unused" }),
			deleteTodo: async () => ({ status: "rejected", message: "unused" }),
			reorderTodo: async () => ({ status: "rejected", message: "unused" }),
			createTodo: async () => ({ status: "rejected", message: "unused" }),
			readSavedViews: async () => ({ status: "applied", views: [] }),
			saveView: async () => ({ status: "rejected", message: "unused" }),
			deleteView: async () => ({ status: "rejected", message: "unused" }),
			readSession: async () => initial,
			restoreSession: async () => initial,
			switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
			writeClipboardText: async () => null,
			selectTodoFile: async () => null,
			deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
			createWorkspace: async () => ({ status: "rejected", message: "Duplicate Workspace name" }),
		},
	});
	await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("Existing");
	await page.getByRole("button", { name: "Create" }).click();
	await expect
		.element(page.getByLabelText("Action result"))
		.toHaveTextContent("Duplicate Workspace name");
	await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("Existing");
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("ready");
});

test("switching preserves a confirmed session on rejection and exposes pending controls", async () => {
	let finish!: (
		outcome: Awaited<
			ReturnType<import("$lib/shared/desktop/contract").DesktopAPI["switchWorkspace"]>
		>
	) => void;
	render(ElectronSessionHarness, {
		desktop: {
			setWorkspaceSortOrder: async () => ({ status: "rejected", message: "unused" }),
			setWorkspaceShowDeferred: async () => ({ status: "rejected", message: "unused" }),
			undoTodo: async () => ({ status: "rejected", message: "unused" }),
			setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
			editTodo: async () => ({ status: "rejected", message: "unused" }),
			deleteTodo: async () => ({ status: "rejected", message: "unused" }),
			reorderTodo: async () => ({ status: "rejected", message: "unused" }),
			createTodo: async () => ({ status: "rejected", message: "unused" }),
			readSavedViews: async () => ({ status: "applied", views: [] }),
			saveView: async () => ({ status: "rejected", message: "unused" }),
			deleteView: async () => ({ status: "rejected", message: "unused" }),
			readSession: async () => confirmed(5, "Original"),
			restoreSession: async () => confirmed(5, "Original"),
			writeClipboardText: async () => null,
			selectTodoFile: async () => null,
			createWorkspace: async () => ({ status: "rejected", message: "unused" }),
			deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
			switchWorkspace: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		},
	});
	await expect.element(page.getByLabelText("Session warning")).toHaveTextContent("Original");
	await page.getByRole("button", { name: "Switch" }).click();
	await expect
		.element(page.getByLabelText("Pending operation"))
		.toHaveTextContent("open_workspace");
	await expect.element(page.getByRole("button", { name: "Create" })).toBeDisabled();
	finish({ status: "rejected", message: "Cannot open file" });
	await expect.element(page.getByLabelText("Action result")).toHaveTextContent("Cannot open file");
	await expect.element(page.getByLabelText("Session warning")).toHaveTextContent("Original");
	await expect.element(page.getByLabelText("Pending operation")).toHaveTextContent("none");
});

test("a confirmed switch opens its intended Workspace with coherent session data", async () => {
	const workspace = {
		id: "550e8400-e29b-41d4-a716-446655440000",
		name: "Switched",
		color: "blue" as const,
		todo_path: "/tmp/switched.todo",
		created_at: "2026-07-10T10:00:00Z",
	};
	let requestedId: string | undefined;
	render(ElectronSessionHarness, {
		desktop: {
			setWorkspaceSortOrder: async () => ({ status: "rejected", message: "unused" }),
			setWorkspaceShowDeferred: async () => ({ status: "rejected", message: "unused" }),
			undoTodo: async () => ({ status: "rejected", message: "unused" }),
			setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
			editTodo: async () => ({ status: "rejected", message: "unused" }),
			deleteTodo: async () => ({ status: "rejected", message: "unused" }),
			reorderTodo: async () => ({ status: "rejected", message: "unused" }),
			createTodo: async () => ({ status: "rejected", message: "unused" }),
			readSavedViews: async () => ({ status: "applied", views: [] }),
			saveView: async () => ({ status: "rejected", message: "unused" }),
			deleteView: async () => ({ status: "rejected", message: "unused" }),
			readSession: async () => confirmed(5, null),
			restoreSession: async () => confirmed(5, null),
			writeClipboardText: async () => null,
			selectTodoFile: async () => null,
			createWorkspace: async () => ({ status: "rejected", message: "unused" }),
			deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
			switchWorkspace: async ({ workspaceId }) => {
				requestedId = workspaceId;
				return {
					status: "applied",
					confirmed: {
						scope,
						revision: 6,
						session: {
							status: "ready",
							catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
							todo_file: { path: workspace.todo_path, items: [], skipped: [] },
						},
					},
				};
			},
		},
	});
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("empty");
	await page.getByRole("button", { name: "Switch" }).click();
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("ready");
	await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("Switched");
	expect(requestedId).toBe(workspace.id);
});

test.each([
	["Create", "rejected"],
	["Switch", "thrown"],
	["Restore", "rejected"],
])("same-turn %s is blocked until creation finishes with a %s failure", async (next, failure) => {
	const requests: string[] = [];
	let finish!: () => void;
	let initialized = false;
	render(ElectronSessionHarness, {
		desktop: {
			readSavedViews: async () => ({ status: "applied", views: [] }),
			saveView: async () => ({ status: "rejected", message: "unused" }),
			deleteView: async () => ({ status: "rejected", message: "unused" }),
			readSession: async () => confirmed(1, null),
			restoreSession: async () => {
				if (!initialized) {
					initialized = true;
					return confirmed(1, null);
				}
				requests.push("restore");
				return confirmed(2, null);
			},
			createWorkspace: () => {
				requests.push("create");
				if (requests.length > 1)
					return Promise.resolve({ status: "rejected", message: "Retry admitted" });
				return new Promise((resolve, reject) => {
					finish = () =>
						failure === "thrown"
							? reject(Error("Creation failed"))
							: resolve({ status: "rejected", message: "Creation failed" });
				});
			},
			switchWorkspace: async () => {
				requests.push("switch");
				return { status: "rejected", message: "Unexpected switch" };
			},
			deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
			editTodo: async () => ({ status: "rejected", message: "unused" }),
			deleteTodo: async () => ({ status: "rejected", message: "unused" }),
			reorderTodo: async () => ({ status: "rejected", message: "unused" }),
			createTodo: async () => ({ status: "rejected", message: "unused" }),
			setWorkspaceSortOrder: async () => ({ status: "rejected", message: "unused" }),
			setWorkspaceShowDeferred: async () => ({ status: "rejected", message: "unused" }),
			undoTodo: async () => ({ status: "rejected", message: "unused" }),
			setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
			writeClipboardText: async () => null,
			selectTodoFile: async () => null,
		},
	});
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("empty");
	const buttons = Array.from(document.querySelectorAll("button"));
	const create = buttons.find((button) => button.textContent === "Create")!;
	const second = buttons.find((button) => button.textContent === next)!;
	// Native clicks keep both actions in the same turn, before reactive DOM updates.
	create.click();
	second.click();
	await expect
		.element(page.getByLabelText("Pending operation"))
		.toHaveTextContent("create_workspace");
	expect(requests).toEqual(["create"]);
	await expect.element(page.getByRole("button", { name: "Create" })).toBeDisabled();
	finish();
	await expect.element(page.getByLabelText("Action result")).toHaveTextContent("Creation failed");
	await expect.element(page.getByRole("button", { name: "Create" })).toBeEnabled();
	await page.getByRole("button", { name: "Create" }).click();
	await expect.element(page.getByLabelText("Action result")).toHaveTextContent("Retry admitted");
	expect(requests).toEqual(["create", "create"]);
});
