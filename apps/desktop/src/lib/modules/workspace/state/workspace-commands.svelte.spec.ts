import { expect, test } from "vitest";
import {
	createDesktopClient,
	type ConfirmedSession,
	type TodoFileChange,
	type WorkspaceRead,
} from "@tuxedo/contracts";
import {
	readCatalogue,
	readWorkspace,
	type CatalogueData,
	type WorkspaceData,
} from "./workspace-route-data";
import { WorkspaceCommands } from "./workspace-commands.svelte";
import { workspaceRouteFixture } from "./testing/workspace-route-fixture.svelte";

const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const workspace = {
	id: workspaceId,
	name: "Personal",
	color: "blue" as const,
	todo_path: "/tmp/todo.txt",
	created_at: "2026-07-10T10:00:00Z",
};
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
const selection = (revision: number) => ({
	scope,
	revision,
	workspaceId,
	todoPath: workspace.todo_path,
});
const contents = (revision: number): Extract<WorkspaceRead, { status: "ready" }> => ({
	status: "ready",
	workspace,
	todo_file: {
		path: workspace.todo_path,
		items: [{ ...item, completed: revision > 5 }],
		skipped: [],
	},
	provenance: { status: "confirmed", selection: selection(revision) },
});

test("completion holds admission and visible contents through route publication", async () => {
	let current: WorkspaceData = { workspaceId, value: contents(5), error: "" };
	let entered!: () => void;
	const refreshing = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let publish!: () => void;
	const released = new Promise<void>((resolve) => {
		publish = resolve;
	});
	const requests: unknown[] = [];
	const desktop = createDesktopClient(async (channel, request) => {
		requests.push(request);
		if (channel === "tuxedo:set-todo-completion")
			return {
				status: "applied",
				confirmed: { scope, revision: 6, workspaceId, todo_file: contents(6).todo_file },
			};
		throw Error(`Unexpected ${channel}`);
	});
	const commands = new WorkspaceCommands(desktop, {
		catalogue: () => ({
			value: {
				status: "ready",
				catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
				selection: selection(5),
			},
			error: "",
		}),
		workspace: () => current,
		destination: () => workspaceId,
		navigating: () => false,
		refresh: async () => {
			entered();
			await released;
			current = { workspaceId, value: contents(6), error: "" };
		},
		navigate: async () => {},
	});
	const completing = commands.setCompletion(item);
	await refreshing;
	expect(commands.todoFile?.items[0].completed).toBe(false);
	expect(commands.isOperating).toBe(true);
	expect(commands.beginNavigation(new Promise(() => {}), "other")).toBe(false);
	expect(await commands.setCompletion(item)).toMatchObject({ status: "rejected" });
	expect(requests).toEqual([
		{ scope, revision: 5, workspaceId, lineNumber: 1, expectedRaw: "Call Mom", completed: true },
	]);
	publish();
	expect(await completing).toEqual({ status: "applied" });
	expect(commands.todoFile?.items[0].completed).toBe(true);
	expect(commands.isOperating).toBe(false);
	expect(commands.canMutate).toBe(true);
});

test("a committed completion with unpublished refresh blocks writes and retries only reads", async () => {
	let current: WorkspaceData = { workspaceId, value: contents(5), error: "" };
	let writes = 0;
	let reads = 0;
	const commands = new WorkspaceCommands(
		createDesktopClient(async (channel) => {
			if (channel !== "tuxedo:set-todo-completion") throw Error(`Unexpected ${channel}`);
			writes++;
			return {
				status: "applied",
				confirmed: { scope, revision: 6, workspaceId, todo_file: contents(6).todo_file },
			};
		}),
		{
			catalogue: () => ({
				value: {
					status: "ready",
					catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
					selection: selection(5),
				},
				error: "",
			}),
			workspace: () => current,
			destination: () => workspaceId,
			navigating: () => false,
			refresh: async () => {
				reads++;
				if (reads > 1) current = { workspaceId, value: contents(6), error: "" };
			},
			navigate: async () => {},
		}
	);
	expect(await commands.setCompletion(item)).toMatchObject({
		status: "applied",
		notice: expect.stringContaining("saved"),
	});
	expect(commands.isOperating).toBe(false);
	expect(commands.canMutate).toBe(false);
	expect(commands.todoFile?.items[0].completed).toBe(false);
	expect(await commands.setCompletion(item)).toMatchObject({ status: "rejected" });
	expect(await commands.retry()).toEqual({ status: "applied" });
	expect({ writes, reads }).toEqual({ writes: 1, reads: 2 });
	expect(commands.canMutate).toBe(true);
});

test("only the current committed destination activates; committed activation failure retries reads", async () => {
	let destination = workspaceId;
	let current: WorkspaceData = {
		workspaceId,
		value: { ...contents(5), provenance: { status: "speculative" as const } },
		error: "",
	};
	let activations = 0;
	let reads = 0;
	const commands = new WorkspaceCommands(
		createDesktopClient(async (channel) => {
			if (channel !== "tuxedo:switch-workspace") throw Error(`Unexpected ${channel}`);
			activations++;
			return {
				status: "applied",
				confirmed: {
					scope,
					revision: 6,
					session: {
						status: "ready",
						catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
						todo_file: contents(6).todo_file,
					},
				},
			};
		}),
		{
			catalogue: () => ({
				value: {
					status: "ready",
					catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
					selection: selection(6),
				},
				error: "",
			}),
			workspace: () => current,
			destination: () => destination,
			navigating: () => reads === 0,
			refresh: async () => {
				reads++;
				if (reads === 1) current = { ...current, error: "Read unavailable" };
				else current = { workspaceId, value: contents(6), error: "" };
			},
			navigate: async () => {},
		}
	);
	await commands.committedDestination("abandoned");
	expect(activations).toBe(0);
	await commands.committedDestination(destination);
	expect(activations).toBe(1);
	expect(commands.isOperating).toBe(false);
	expect(commands.canMutate).toBe(false);
	expect(await commands.retry()).toEqual({ status: "applied" });
	expect(activations).toBe(1);
	expect(commands.canMutate).toBe(true);
});

test("a stale same-Workspace publication revalidates its receipt without activating again", async () => {
	let current: WorkspaceData = { workspaceId, value: contents(5), error: "" };
	let reads = 0;
	let activations = 0;
	const commands = new WorkspaceCommands(
		createDesktopClient(async (channel) => {
			if (channel === "tuxedo:switch-workspace") {
				activations++;
				return { status: "rejected", message: "Unexpected activation" };
			}
			if (channel === "tuxedo:set-todo-completion")
				return {
					status: "applied",
					confirmed: { scope, revision: 6, workspaceId, todo_file: contents(6).todo_file },
				};
			throw Error(`Unexpected ${channel}`);
		}),
		{
			catalogue: () => ({
				value: {
					status: "ready",
					catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
					selection: selection(6),
				},
				error: "",
			}),
			workspace: () => current,
			destination: () => workspaceId,
			navigating: () => false,
			refresh: async () => {
				reads++;
				current = { workspaceId, value: contents(6), error: "" };
			},
			navigate: async () => {},
		}
	);
	expect(await commands.setCompletion(item)).toEqual({ status: "applied" });
	current = { workspaceId, value: contents(5), error: "" };
	await commands.committedDestination(workspaceId);
	expect({ reads, activations }).toEqual({ reads: 2, activations: 0 });
	expect(commands.canMutate).toBe(true);
});

test("a relevant observation queued during navigation refreshes before the committed reader unlocks", async () => {
	let current: WorkspaceData = { workspaceId, value: contents(5), error: "" };
	let navigating = true;
	let signal!: (event: import("@tuxedo/contracts").TodoFileChange) => void;
	let reads = 0;
	let notices = 0;
	const commands = new WorkspaceCommands(
		createDesktopClient(async () => {
			throw Error("Unexpected write");
		}),
		{
			catalogue: () => ({
				value: {
					status: "ready",
					catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
					selection: selection(6),
				},
				error: "",
			}),
			workspace: () => current,
			destination: () => workspaceId,
			navigating: () => navigating,
			refresh: async () => {
				reads++;
				current = { workspaceId, value: contents(6), error: "" };
			},
			navigate: async () => {},
		}
	);
	const stop = commands.observe(
		{
			onTodoFileChanged: (listener) => {
				signal = listener;
				return () => {};
			},
		},
		() => {
			notices++;
		}
	);
	signal({ scope, revision: 6, workspaceId, todoPath: workspace.todo_path });
	expect(reads).toBe(0);
	const committed = commands.committedDestination(workspaceId);
	navigating = false;
	await committed;
	expect(reads).toBe(1);
	expect(commands.todoFile?.items[0].completed).toBe(true);
	expect(commands.canMutate).toBe(true);
	expect(notices).toBe(1);
	stop();
});

test("a conflict whose confirmed disk refresh fails is never described as a saved change", async () => {
	let current: WorkspaceData = { workspaceId, value: contents(5), error: "" };
	let reads = 0;
	let writes = 0;
	const commands = new WorkspaceCommands(
		createDesktopClient(async (channel) => {
			if (channel !== "tuxedo:set-todo-completion") throw Error(`Unexpected ${channel}`);
			writes++;
			return {
				status: "conflict",
				message: "Changed on disk",
				confirmed: { scope, revision: 6, workspaceId, todo_file: contents(6).todo_file },
			};
		}),
		{
			catalogue: () => ({
				value: {
					status: "ready",
					catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
					selection: selection(6),
				},
				error: "",
			}),
			workspace: () => current,
			destination: () => workspaceId,
			navigating: () => false,
			refresh: async () => {
				reads++;
				if (reads > 1) current = { workspaceId, value: contents(6), error: "" };
			},
			navigate: async () => {},
		}
	);
	expect(await commands.setCompletion(item)).toMatchObject({
		status: "conflict",
		message: expect.stringContaining("refresh"),
	});
	expect(commands.isOperating).toBe(false);
	expect(commands.canMutate).toBe(false);
	expect(await commands.retry()).toEqual({ status: "applied" });
	expect(writes).toBe(1);
	expect(commands.canMutate).toBe(true);
});

test.each([false, true])(
	"Home observes an Empty session and re-entry activates once (catalogue Retry: %s)",
	async (rejectCatalogue) => {
		let revision = 5;
		let active = false;
		let fileExists = true;
		let failCatalogue = false;
		let activations = 0;
		let signal!: (event: TodoFileChange) => void;
		const catalogue = { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] };
		const fixture = workspaceRouteFixture(
			createDesktopClient(async (channel) => {
				if (channel === "tuxedo:read-workspace-catalogue")
					return failCatalogue
						? { status: "rejected", reason: "catalogue", message: "Catalogue unavailable" }
						: {
								status: "ready",
								catalogue,
								selection: active
									? selection(revision)
									: { scope, revision, workspaceId: null, todoPath: null },
							};
				if (channel === "tuxedo:read-workspace")
					return !fileExists
						? { status: "rejected", reason: "todo-file", message: "Todo file missing" }
						: {
								...contents(revision),
								provenance: active ? contents(revision).provenance : { status: "speculative" },
							};
				if (channel === "tuxedo:switch-workspace") {
					activations++;
					active = true;
					revision++;
					return {
						status: "applied",
						confirmed: {
							scope,
							revision,
							session: { status: "ready", catalogue, todo_file: contents(revision).todo_file },
						},
					};
				}
				throw Error(`Unexpected ${channel}`);
			})
		);
		await fixture.start();
		expect(activations).toBe(0);
		await fixture.navigate(workspaceId);
		expect(fixture.commands.canMutate).toBe(true);
		const stop = fixture.commands.observe(
			{
				onTodoFileChanged(listener) {
					signal = listener;
					return () => {};
				},
			},
			() => {}
		);
		await fixture.navigate(undefined);
		expect(active).toBe(true);
		expect(activations).toBe(1);

		// Observation accepts the missing file before notifying Home; reads cannot reactivate it.
		active = false;
		fileExists = false;
		revision++;
		failCatalogue = rejectCatalogue;
		signal({ ...selection(revision) });
		await expect.poll(() => fixture.commands.isOperating).toBe(false);
		if (rejectCatalogue) {
			expect(fixture.commands.recoveryError).toBe("Catalogue unavailable");
			failCatalogue = false;
			expect(await fixture.commands.retry()).toEqual({ status: "applied" });
		}
		expect(fixture.commands.todoFile).toBeNull();
		expect(fixture.commands.recoveryError).toBe("");
		expect(activations).toBe(1);
		fileExists = true;
		await fixture.navigate(workspaceId);
		expect(activations).toBe(2);
		expect(fixture.commands.canMutate).toBe(true);
		stop();
	}
);

test("Retry refreshes a failed observation catalogue even when Workspace contents reached its revision", async () => {
	let revision = 5;
	let failCatalogue = false;
	let writes = 0;
	let signal!: (event: TodoFileChange) => void;
	const fixture = workspaceRouteFixture(
		createDesktopClient(async (channel) => {
			if (channel === "tuxedo:read-workspace-catalogue")
				return failCatalogue
					? { status: "rejected", reason: "catalogue", message: "Catalogue unavailable" }
					: {
							status: "ready",
							catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
							selection: selection(revision),
						};
			if (channel === "tuxedo:read-workspace") return contents(revision);
			if (channel === "tuxedo:set-todo-completion") {
				writes++;
				revision++;
				return {
					status: "applied",
					confirmed: { scope, revision, workspaceId, todo_file: contents(revision).todo_file },
				};
			}
			throw Error(`Unexpected ${channel}`);
		})
	);
	await fixture.start();
	// A successful command has already cleared its catalogue refresh requirement.
	expect(await fixture.commands.setCompletion(item)).toEqual({ status: "applied" });
	const stop = fixture.commands.observe(
		{
			onTodoFileChanged(listener) {
				signal = listener;
				return () => {};
			},
		},
		() => {}
	);
	revision++;
	failCatalogue = true;
	signal(selection(revision));
	await expect.poll(() => fixture.commands.isOperating).toBe(false);
	expect(fixture.commands.canMutate).toBe(false);
	expect(await fixture.commands.retry()).toEqual({
		status: "rejected",
		message: "Catalogue unavailable",
	});
	failCatalogue = false;
	expect(await fixture.commands.retry()).toEqual({ status: "applied" });
	expect(fixture.commands.canMutate).toBe(true);
	expect(writes).toBe(1);
	stop();
});

test.each(["create", "delete-active", "delete-inactive"] as const)(
	"a queued Home observation cannot replace a newer %s receipt",
	async (operation) => {
		const nextWorkspace = {
			...workspace,
			id: "550e8400-e29b-41d4-a716-446655440001",
			name: "Next",
			todo_path: "/tmp/next.txt",
		};
		let backend: ConfirmedSession = {
			scope,
			revision: 5,
			session: {
				status: "ready",
				catalogue: {
					version: 1,
					active_workspace_id: workspaceId,
					workspaces: operation === "create" ? [workspace] : [workspace, nextWorkspace],
				},
				todo_file: contents(5).todo_file,
			},
		};
		let entered!: () => void;
		const admitted = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let finish!: () => void;
		const released = new Promise<void>((resolve) => {
			finish = resolve;
		});
		let signal!: (event: TodoFileChange) => void;
		let changes = 0;
		let catalogueReads = 0;
		const desktop = createDesktopClient(async (channel) => {
			if (
				channel === "tuxedo:read-workspace-catalogue" &&
				backend.session.status !== "unavailable"
			) {
				catalogueReads++;
				return {
					status: "ready",
					catalogue: backend.session.catalogue,
					selection: {
						scope,
						revision: backend.revision,
						workspaceId:
							backend.session.status === "ready"
								? backend.session.catalogue.active_workspace_id
								: null,
						todoPath: backend.session.status === "ready" ? backend.session.todo_file.path : null,
					},
				};
			}
			if (channel === "tuxedo:read-workspace") return contents(backend.revision);
			if (channel === "tuxedo:set-todo-completion") {
				backend = { ...backend, revision: 6 };
				return {
					status: "applied",
					confirmed: { scope, revision: 6, workspaceId, todo_file: contents(6).todo_file },
				};
			}
			if (channel === "tuxedo:create-workspace" || channel === "tuxedo:delete-workspace") {
				changes++;
				entered();
				await released;
				backend = {
					scope,
					revision: 8,
					session: {
						status: "ready",
						catalogue: {
							version: 1,
							active_workspace_id: nextWorkspace.id,
							workspaces: [workspace, nextWorkspace],
						},
						todo_file: { path: nextWorkspace.todo_path, items: [], skipped: [] },
					},
				};
				if (operation === "delete-active")
					backend = {
						scope,
						revision: 8,
						session: {
							status: "empty",
							catalogue: { version: 1, active_workspace_id: null, workspaces: [nextWorkspace] },
							warning: null,
						},
					};
				if (operation === "delete-inactive")
					backend = {
						scope,
						revision: 8,
						session: {
							status: "ready",
							catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
							todo_file: contents(8).todo_file,
						},
					};
				return { status: "applied", confirmed: backend };
			}
			throw Error(`Unexpected ${channel}`);
		});
		let catalogue: CatalogueData = await readCatalogue(desktop, () => undefined);
		let current = await readWorkspace(desktop, workspaceId, () => undefined);
		let destination: string | undefined = workspaceId;
		const commands = new WorkspaceCommands(desktop, {
			catalogue: () => catalogue,
			workspace: () => current,
			destination: () => destination,
			navigating: () => false,
			refresh: async (id, shared) => {
				if (shared) catalogue = await readCatalogue(desktop, () => catalogue);
				if (id) current = await readWorkspace(desktop, id, () => current);
			},
			navigate: async () => {
				throw Error("Navigation unavailable");
			},
		});
		expect(await commands.setCompletion(item)).toEqual({ status: "applied" });
		destination = undefined;
		await commands.committedDestination(undefined);
		const stop = commands.observe(
			{
				onTodoFileChanged(listener) {
					signal = listener;
					return () => {};
				},
			},
			() => {}
		);
		const readsBefore = catalogueReads;
		const saving =
			operation === "create"
				? commands.create({
						name: nextWorkspace.name,
						color: nextWorkspace.color,
						todoPath: nextWorkspace.todo_path,
					})
				: commands.deleteWorkspace(operation === "delete-active" ? workspaceId : nextWorkspace.id);
		await admitted;
		signal(selection(7));
		finish();
		const outcome = await saving;
		expect(outcome.status).toBe("applied");
		if (operation === "create")
			expect(outcome).toMatchObject({ notice: expect.stringContaining("created") });
		await expect.poll(() => commands.isOperating).toBe(false);
		expect(catalogueReads - readsBefore).toBe(operation === "create" ? 0 : 1);
		expect(await commands.retry()).toEqual({ status: "applied" });
		expect(commands.recoveryError).toBe("");
		expect(commands.catalogue?.active_workspace_id).toBe(
			operation === "create" ? nextWorkspace.id : operation === "delete-active" ? null : workspaceId
		);
		expect(destination).toBeUndefined();
		expect(changes).toBe(1);
		stop();
	}
);
