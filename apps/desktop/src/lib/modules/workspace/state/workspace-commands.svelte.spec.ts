import { expect, test } from "vitest";
import {
	createDesktopClient,
	confirmedSessionSchema,
	desktopContract,
	type ConfirmedSession,
	type TodoFileChange,
	type TodoFileObservation,
} from "@tuxedo/contracts";
import { WorkspaceCommands } from "./workspace-commands.svelte";
import { workspaceNavigation } from "#lib/app/workspace-navigation.svelte.js";
import { observationInvalidation } from "#lib/app/observation-invalidation.js";
import type { DisplayedDataTarget } from "./invalidate-displayed-data";
import {
	readSession,
	readWorkspace,
	type SessionData,
	type WorkspaceData,
} from "./workspace-route-data";

const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const otherId = "550e8400-e29b-41d4-a716-446655440001";
const workspace = {
	id: workspaceId,
	name: "Personal",
	color: "blue",
	todo_path: "/tmp/todo.txt",
	created_at: "2026-07-10T10:00:00Z",
} as const;
const item = {
	line_number: 1,
	raw: "Call Mom",
	completed: false,
	priority: null,
	creation_date: null,
	completion_date: null,
	description: "Call Mom",
	projects: [],
	contexts: [],
	metadata: {},
	edit: { description: "Call Mom", metadata: [] },
};
function snapshot(revision = 5): ConfirmedSession {
	return {
		scope,
		revision,
		session: {
			status: "ready",
			catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
			todo_file: {
				path: workspace.todo_path,
				items: [{ ...item, completed: revision > 5 }],
				skipped: [],
			},
		},
	};
}
function todo(revision: number) {
	const current = snapshot(revision);
	if (current.session.status !== "ready") throw Error("Expected loaded Todo file");
	return { scope, revision, workspaceId, todo_file: current.session.todo_file };
}
function selected(id: string, revision: number): ConfirmedSession {
	const selectedWorkspace = { ...workspace, id, name: id, todo_path: `/tmp/${id}.txt` };
	return {
		scope,
		revision,
		session: {
			status: "ready",
			catalogue: {
				version: 1,
				active_workspace_id: id,
				workspaces: [workspace, selectedWorkspace],
			},
			todo_file: { path: selectedWorkspace.todo_path, items: [item], skipped: [] },
		},
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function fixture(invoke?: (channel: string, request: unknown) => Promise<unknown>) {
	let backend = snapshot();
	let destination: string | undefined = workspaceId;
	let session: SessionData | undefined;
	let workspaceData: WorkspaceData | undefined;
	let navigating = false;
	let navigationStep: (() => Promise<void>) | undefined;
	let refreshStep: (() => Promise<void>) | undefined;
	const calls: string[] = [];
	const desktop = createDesktopClient(async (channel, request) => {
		calls.push(channel);
		const result = await invoke?.(channel, request);
		if (result !== undefined) {
			const read = confirmedSessionSchema.safeParse(result);
			if (read.success) backend = read.data;
			if (result && typeof result === "object" && "confirmed" in result) {
				const lifecycle = confirmedSessionSchema.safeParse(result.confirmed);
				const todoResult = desktopContract.setTodoCompletion.response.safeParse(result);
				if (lifecycle.success && lifecycle.data.revision >= backend.revision)
					backend = lifecycle.data;
				else if (
					todoResult.success &&
					todoResult.data.status !== "rejected" &&
					backend.session.status === "ready" &&
					todoResult.data.confirmed.revision >= backend.revision
				) {
					const confirmed = todoResult.data.confirmed;
					backend = {
						scope: confirmed.scope,
						revision: confirmed.revision,
						...(confirmed.undoLabel ? { undoLabel: confirmed.undoLabel } : {}),
						session: { ...backend.session, todo_file: confirmed.todo_file },
					};
				}
			}
			return result;
		}
		if (channel === "tuxedo:read-session" || channel === "tuxedo:refresh-session") return backend;
		if (channel === "tuxedo:read-workspace") {
			if (backend.session.status !== "ready")
				return { status: "rejected", message: "Todo file unavailable" };
			const current = backend.session;
			const id = (request as { workspaceId: string }).workspaceId;
			const selectedWorkspace = current.catalogue.workspaces.find((w) => w.id === id);
			if (!selectedWorkspace) return { status: "rejected", message: "Workspace does not exist." };
			return {
				status: "ready",
				workspace: selectedWorkspace,
				todo_file:
					selectedWorkspace.id === current.catalogue.active_workspace_id
						? current.todo_file
						: { path: selectedWorkspace.todo_path, items: [], skipped: [] },
				confirmation:
					selectedWorkspace.id === current.catalogue.active_workspace_id
						? {
								scope: backend.scope,
								revision: backend.revision,
								...(backend.undoLabel ? { undoLabel: backend.undoLabel } : {}),
							}
						: null,
			};
		}
		throw Error(`Unexpected ${channel}`);
	});
	const invalidations: DisplayedDataTarget[] = [];
	const invalidate = async (target: DisplayedDataTarget) => {
		invalidations.push(target);
		const { session: includeSession, workspaceId: id } = target;
		await refreshStep?.();
		if (includeSession) session = await readSession(desktop, () => session);
		if (id) workspaceData = await readWorkspace(desktop, id, () => workspaceData);
	};
	const navigations: Array<{ id: string | null; replace: boolean }> = [];
	const routes = {
		session: () => session,
		workspace: () => workspaceData,
		destination: () => destination,
		navigating: () => navigating,
		invalidate,
	};
	const commands = new WorkspaceCommands(desktop, routes);
	const observations = observationInvalidation(commands, routes);
	const navigation = workspaceNavigation(commands, {
		...routes,
		flushObservation: observations.flush,
		navigate: async (id, replace = false) => {
			navigations.push({ id, replace });
			destination = id ?? undefined;
			await invalidate({ workspaceId: id, session: true });
			await navigation.committedDestination();
			await navigationStep?.();
		},
	});
	return {
		commands,
		navigation,
		get todoFile() {
			return workspaceData && workspaceData.workspaceId === destination
				? (workspaceData.value?.todo_file ?? null)
				: null;
		},
		get undoLabel() {
			return workspaceData?.value?.confirmation?.undoLabel;
		},
		get catalogue() {
			return session?.value?.session.status !== "unavailable"
				? session?.value?.session.catalogue
				: undefined;
		},
		get activeWorkspaceId() {
			return session?.value?.session.status !== "unavailable"
				? session?.value?.session.catalogue.active_workspace_id
				: undefined;
		},
		get warning() {
			return session?.value?.session.status === "empty" ? session.value.session.warning : "";
		},
		observe: (observation: TodoFileObservation, notify: () => void) =>
			observations.observe(observation, (changed) => {
				navigation.observed(changed);
				if (changed) notify();
			}),
		desktop,
		calls,
		invalidations,
		navigations,
		start: () => invalidate({ workspaceId: destination ?? null, session: true }),
		publishSession: (resource: SessionData) => {
			session = resource;
		},
		setBackend: (value: ConfirmedSession) => {
			backend = value;
		},
		setDestination: (id: string | undefined) => {
			destination = id;
		},
		setNavigating: (value: boolean) => {
			navigating = value;
		},
		setNavigationStep: (step: () => Promise<void>) => {
			navigationStep = step;
		},
		setRefreshStep: (step: () => Promise<void>) => {
			refreshStep = step;
		},
	};
}

function observation() {
	let receive: ((event: TodoFileChange) => void) | undefined;
	const source: TodoFileObservation = {
		onTodoFileChanged: (listener) => {
			receive = listener;
			return () => {
				receive = undefined;
			};
		},
	};
	return {
		source,
		signal: (revision: number, overrides: Partial<TodoFileChange> = {}) =>
			receive?.({ scope, revision, workspaceId, todoPath: workspace.todo_path, ...overrides }),
	};
}

test("completion publishes loader data before admitting the next command", async () => {
	const entered = deferred<void>();
	const response = deferred<unknown>();
	const reading = deferred<void>();
	const publication = deferred<void>();
	const requests: unknown[] = [];
	const f = fixture(async (channel, request) => {
		if (channel === "tuxedo:set-todo-completion") {
			requests.push(request);
			if (requests.length === 1) {
				entered.resolve();
				return response.promise;
			}
			return { status: "applied", confirmed: todo(7) };
		}
	});
	await f.start();
	f.setRefreshStep(async () => {
		reading.resolve();
		await publication.promise;
	});
	const completing = f.commands.setCompletion(item);
	await entered.promise;
	expect(f.todoFile?.items[0].completed).toBe(false);
	expect(f.commands.isOperating).toBe(true);
	expect(await f.commands.deleteTodo(item)).toMatchObject({ status: "rejected" });
	response.resolve({ status: "applied", confirmed: todo(6) });
	await reading.promise;
	expect(f.todoFile?.items[0].completed).toBe(false);
	expect(f.commands.isOperating).toBe(true);
	publication.resolve();
	expect(await completing).toEqual({ status: "applied" });
	expect(f.todoFile?.items[0].completed).toBe(true);
	expect(f.commands.canMutate).toBe(true);
	await f.commands.setCompletion(f.todoFile!.items[0]);
	expect(requests).toMatchObject([{ revision: 5 }, { revision: 6 }]);
	expect(f.calls.filter((channel) => channel === "tuxedo:read-session")).toHaveLength(1);
});

test("a conflict displays confirmed disk contents; rejection retains them", async () => {
	let writes = 0;
	const f = fixture(async (channel) => {
		if (channel === "tuxedo:set-todo-completion")
			return ++writes === 1
				? { status: "conflict", message: "Changed on disk", confirmed: todo(6) }
				: { status: "rejected", message: "Cannot write Todo file" };
	});
	await f.start();
	expect(await f.commands.setCompletion(item)).toEqual({
		status: "conflict",
		message: "Changed on disk",
	});
	expect(f.todoFile?.items[0].completed).toBe(true);
	expect(await f.commands.setCompletion(item)).toEqual({
		status: "rejected",
		message: "Cannot write Todo file",
	});
	expect(f.todoFile?.items[0].completed).toBe(true);
	expect(f.commands.canMutate).toBe(true);
	expect(f.calls.filter((channel) => channel === "tuxedo:read-session")).toHaveLength(1);
});

test("a lost write response preserves contents and blocks writes until read-only recovery", async () => {
	let writes = 0;
	let failRead = false;
	const f = fixture(async (channel) => {
		if (channel === "tuxedo:set-todo-completion") {
			writes++;
			throw Error("Response lost after save");
		}
		if (channel === "tuxedo:refresh-session" && failRead) throw Error("Read unavailable");
	});
	await f.start();
	expect(await f.commands.setCompletion(item)).toMatchObject({ status: "rejected" });
	expect(f.commands.isOperating).toBe(false);
	expect(f.todoFile?.items[0].completed).toBe(false);
	expect(f.commands.canMutate).toBe(false);
	f.publishSession({ value: snapshot(), error: "" });
	expect(f.commands.canMutate).toBe(false);
	expect(await f.commands.setCompletion(item)).toMatchObject({ status: "rejected" });
	failRead = true;
	expect(await f.navigation.retry()).toEqual({ status: "rejected", message: "Read unavailable" });
	failRead = false;
	f.setBackend(snapshot(6));
	expect(await f.navigation.retry()).toEqual({ status: "applied", activeWorkspaceId: workspaceId });
	expect(f.todoFile?.items[0].completed).toBe(true);
	expect(f.commands.canMutate).toBe(true);
	expect(writes).toBe(1);
});

test("Retry returns Home when a failed observation read recovers to Empty with the same Active workspace", async () => {
	let reads = 0;
	let failRead = true;
	const f = fixture(async (channel) => {
		if (channel === "tuxedo:read-session" && ++reads > 1 && failRead)
			throw Error("Read unavailable");
	});
	await f.start();
	const events = observation();
	const stop = f.observe(events.source, () => {});
	f.setNavigating(true);
	events.signal(6);
	await f.navigation.committedDestination();
	f.setNavigating(false);
	expect(f.commands.recoveryError).toBe("Read unavailable");
	expect(f.todoFile).not.toBeNull();
	f.setBackend({
		scope,
		revision: 6,
		session: {
			status: "empty",
			catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
			warning: "Todo file missing",
		},
	});
	failRead = false;
	expect(await f.navigation.retry()).toEqual({ status: "applied", activeWorkspaceId: null });
	expect(f.navigations).toEqual([{ id: null, replace: true }]);
	expect(f.commands.recoveryError).toBe("");
	expect(f.warning).toBe("Todo file missing");
	expect(f.commands.isOperating).toBe(false);
	stop();
});

test("disagreeing session and destination reads block writes until Retry re-reads both", async () => {
	const f = fixture();
	await f.start();
	for (const value of [snapshot(6), { ...snapshot(5), scope: otherId }]) {
		f.publishSession({ value, error: "" });
		expect(f.commands.canMutate).toBe(false);
		expect(await f.commands.setCompletion(item)).toMatchObject({ status: "rejected" });
	}
	f.setBackend(snapshot(7));
	expect(await f.navigation.retry()).toEqual({ status: "applied", activeWorkspaceId: workspaceId });
	expect(f.commands.canMutate).toBe(true);
	expect(f.calls).not.toContain("tuxedo:set-todo-completion");
});

test("startup resumes once with replacement while Home and abandoned destinations preserve selection and Undo", async () => {
	const f = fixture();
	f.setBackend({ ...snapshot(), undoLabel: "Undo edit" });
	f.setDestination(undefined);
	await f.start();
	await f.navigation.committedDestination(true);
	expect(f.navigations).toEqual([{ id: workspaceId, replace: true }]);
	expect(f.undoLabel).toBe("Undo edit");
	await f.navigation.committedDestination();
	f.setDestination(undefined);
	await f.navigation.committedDestination();
	expect(f.todoFile).toBeNull();
	expect(f.catalogue?.active_workspace_id).toBe(workspaceId);
	f.setDestination(workspaceId);
	await f.navigation.committedDestination();
	expect(f.undoLabel).toBe("Undo edit");
	expect(f.calls).not.toContain("tuxedo:switch-workspace");
});

test("creation navigates after admission ends without switching the created Workspace again", async () => {
	const created = { ...workspace, id: otherId, name: "Next", todo_path: "/tmp/next.txt" };
	const f = fixture(async (channel) =>
		channel === "tuxedo:create-workspace"
			? {
					status: "applied",
					confirmed: {
						scope,
						revision: 6,
						session: {
							status: "ready",
							catalogue: {
								version: 1,
								active_workspace_id: otherId,
								workspaces: [workspace, created],
							},
							todo_file: { path: created.todo_path, items: [], skipped: [] },
						},
					},
				}
			: undefined
	);
	await f.start();
	f.setNavigationStep(async () => {
		expect(f.commands.isOperating).toBe(false);
	});
	expect(
		await f.navigation.create({
			name: created.name,
			color: created.color,
			todoPath: created.todo_path,
		})
	).toEqual({ status: "applied", workspaceId: otherId });
	expect(f.activeWorkspaceId).toBe(otherId);
	expect(f.commands.canMutate).toBe(true);
	expect(f.calls).not.toContain("tuxedo:switch-workspace");
});

test("external changes received during a write refresh afterward, while stale targets are ignored", async () => {
	const entered = deferred<void>();
	const response = deferred<unknown>();
	const noticed = deferred<void>();
	let reads = 0;
	const f = fixture(async (channel) => {
		if (channel === "tuxedo:set-todo-completion") {
			entered.resolve();
			return response.promise;
		}
		if (channel === "tuxedo:read-session" && ++reads > 1)
			return {
				...snapshot(7),
				session: {
					status: "ready",
					catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
					todo_file: {
						...todo(7).todo_file,
						items: [{ ...item, description: "External", raw: "External" }],
					},
				},
			};
	});
	await f.start();
	const events = observation();
	let notices = 0;
	const stop = f.observe(events.source, () => {
		notices++;
		noticed.resolve();
	});
	const completing = f.commands.setCompletion(item);
	await entered.promise;
	events.signal(7);
	expect(reads).toBe(1);
	response.resolve({ status: "applied", confirmed: todo(6) });
	await completing;
	await noticed.promise;
	expect(f.todoFile?.items[0].description).toBe("External");
	expect(notices).toBe(1);
	events.signal(8, { workspaceId: otherId });
	events.signal(6);
	expect(reads).toBe(2);
	stop();
});

test("a change queued during navigation reaches the committed reader; a missing file recovers to Home", async () => {
	const f = fixture();
	await f.start();
	const events = observation();
	let notices = 0;
	const stop = f.observe(events.source, () => {
		notices++;
	});
	f.setNavigating(true);
	f.setBackend(snapshot(6));
	events.signal(6);
	expect(f.calls.filter((channel) => channel === "tuxedo:read-session")).toHaveLength(1);
	await f.navigation.committedDestination();
	f.setNavigating(false);
	expect(f.todoFile?.items[0].completed).toBe(true);
	expect(notices).toBe(1);
	f.setBackend({
		scope,
		revision: 7,
		session: {
			status: "empty",
			catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
			warning: "Todo file missing",
		},
	});
	f.setNavigating(true);
	events.signal(7);
	await f.navigation.committedDestination();
	f.setNavigating(false);
	expect(f.todoFile).toBeNull();
	expect(f.navigations).toEqual([{ id: null, replace: true }]);
	expect(f.warning).toBe("Todo file missing");
	expect(f.commands.recoveryError).toBe("");
	expect(f.commands.isOperating).toBe(false);
	stop();
});

test("a newer committed destination activates after an already admitted activation settles", async () => {
	const latestId = "550e8400-e29b-41d4-a716-446655440003";
	const entered = deferred<void>();
	const response = deferred<unknown>();
	const switched: string[] = [];
	const f = fixture(async (channel, request) => {
		if (
			channel === "tuxedo:switch-workspace" &&
			request &&
			typeof request === "object" &&
			"workspaceId" in request
		) {
			if (request.workspaceId === otherId) {
				switched.push(otherId);
				entered.resolve();
				return response.promise;
			}
			if (request.workspaceId === latestId) {
				switched.push(latestId);
				return { status: "applied", confirmed: selected(latestId, 7) };
			}
		}
	});
	await f.start();
	f.setDestination(otherId);
	const activating = f.navigation.committedDestination();
	await entered.promise;
	f.setDestination(latestId);
	const superseding = f.navigation.committedDestination();
	response.resolve({ status: "applied", confirmed: selected(otherId, 6) });
	await Promise.all([activating, superseding]);
	expect(switched).toEqual([otherId, latestId]);
	expect(f.activeWorkspaceId).toBe(latestId);
	expect(f.commands.canMutate).toBe(true);
});

test("a new Workspace's external change survives its delayed activation response", async () => {
	const entered = deferred<void>();
	const response = deferred<unknown>();
	const noticed = deferred<void>();
	const f = fixture(async (channel) => {
		if (channel === "tuxedo:switch-workspace") {
			entered.resolve();
			return response.promise;
		}
	});
	await f.start();
	const events = observation();
	const stop = f.observe(events.source, () => noticed.resolve());
	f.setDestination(otherId);
	const activating = f.navigation.committedDestination();
	await entered.promise;
	const external = selected(otherId, 7);
	if (external.session.status !== "ready") throw Error("Expected loaded Todo file");
	external.session.todo_file.items[0] = { ...item, raw: "External", description: "External" };
	f.setBackend(external);
	events.signal(7, { workspaceId: otherId, todoPath: external.session.todo_file.path });
	// An older notification from the previous Workspace cannot replace that queued change.
	events.signal(6);
	response.resolve({ status: "applied", confirmed: selected(otherId, 6) });
	await activating;
	await noticed.promise;
	expect(f.activeWorkspaceId).toBe(otherId);
	expect(f.todoFile?.items[0].description).toBe("External");
	expect(f.calls.filter((channel) => channel === "tuxedo:switch-workspace")).toHaveLength(1);
	stop();
});

test("a newer committed destination wins while creation's navigation finishes", async () => {
	const latestId = "550e8400-e29b-41d4-a716-446655440003";
	const entered = deferred<void>();
	const finishNavigation = deferred<void>();
	const switched: unknown[] = [];
	const f = fixture(async (channel, request) => {
		if (channel === "tuxedo:create-workspace")
			return { status: "applied", confirmed: selected(otherId, 6) };
		if (channel === "tuxedo:switch-workspace") {
			switched.push(request);
			return { status: "applied", confirmed: selected(latestId, 7) };
		}
	});
	await f.start();
	f.setNavigationStep(async () => {
		entered.resolve();
		await finishNavigation.promise;
	});
	const creating = f.navigation.create({
		name: "Next",
		color: "blue",
		todoPath: `/tmp/${otherId}.txt`,
	});
	await entered.promise;
	f.setDestination(latestId);
	await f.navigation.committedDestination();
	finishNavigation.resolve();
	expect(await creating).toMatchObject({ status: "applied" });
	expect(switched).toEqual([{ workspaceId: latestId }]);
	expect(f.activeWorkspaceId).toBe(latestId);
	expect(f.commands.canMutate).toBe(true);
});

test("lifecycle commands call one RPC and invalidate the loaders holding the changed data", async () => {
	type Fixture = ReturnType<typeof fixture>;
	const cases: Array<{
		run: (f: Fixture) => Promise<unknown>;
		channel: string | null;
		target: { session: boolean; workspaceId: string | null };
		result: object;
	}> = [
		{
			run: (f) =>
				f.commands.create({ name: "Next", color: "blue", todoPath: `/tmp/${otherId}.txt` }),
			channel: "tuxedo:create-workspace",
			target: { session: true, workspaceId: null },
			result: { status: "applied", workspaceId: otherId },
		},
		{
			run: (f) => f.commands.deleteWorkspace(otherId),
			channel: "tuxedo:delete-workspace",
			target: { session: true, workspaceId },
			result: { status: "applied", activeWorkspaceId: workspaceId },
		},
		{
			run: (f) => {
				f.setDestination(otherId);
				return f.commands.activate(otherId);
			},
			channel: "tuxedo:switch-workspace",
			target: { session: true, workspaceId: otherId },
			result: { status: "applied" },
		},
		{
			run: (f) => f.commands.setSortOrder("due"),
			channel: "tuxedo:set-workspace-sort-order",
			target: { session: true, workspaceId },
			result: { status: "applied" },
		},
		{
			run: (f) => f.commands.setShowDeferred(true),
			channel: "tuxedo:set-workspace-show-deferred",
			target: { session: true, workspaceId },
			result: { status: "applied" },
		},
		{
			run: (f) => f.commands.retry(),
			channel: "tuxedo:refresh-session",
			target: { session: true, workspaceId },
			result: { status: "applied", activeWorkspaceId: workspaceId },
		},
		{
			run: (f) => f.commands.activate(workspaceId),
			channel: null,
			target: { session: true, workspaceId },
			result: { status: "applied" },
		},
	];
	for (const { run, channel, target, result } of cases) {
		const f = fixture(async (called) => {
			if (called === "tuxedo:create-workspace" || called === "tuxedo:switch-workspace")
				return { status: "applied", confirmed: selected(otherId, 6) };
			if (called.startsWith("tuxedo:set-workspace-") || called === "tuxedo:delete-workspace")
				return { status: "applied", confirmed: snapshot(6) };
		});
		await f.start();
		const calls = f.calls.length;
		const invalidations = f.invalidations.length;
		expect(await run(f)).toEqual(result);
		expect(
			f.calls.slice(calls).filter((call) => !call.startsWith("tuxedo:read-")),
			channel ?? "activate confirmed"
		).toEqual(channel ? [channel] : []);
		expect(
			f.invalidations
				.slice(invalidations)
				.map(({ session = false, workspaceId = null }) => ({ session, workspaceId }))
		).toEqual([target]);
	}
});
