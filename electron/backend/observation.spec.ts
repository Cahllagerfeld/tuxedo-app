import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { mkdtemp, mkdir, rm, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSessionBackend } from "./session-runtime";
import { createTodoFileObservation, type TodoFileObservationAdapter } from "./observation";
import type { TodoFileChange } from "../../src/lib/shared/desktop/contract";
import { rename } from "node:fs/promises";

const directories: string[] = [];
const backends: ReturnType<typeof createSessionBackend>[] = [];
let filesystem: FileSystem;
beforeAll(async () => {
	filesystem = await Effect.runPromise(FileSystem.pipe(Effect.provide(NodeFileSystem.layer)));
});
afterEach(async () => {
	await Promise.all(backends.splice(0).map((backend) => backend.dispose()));
	vi.restoreAllMocks();
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});

test("retargeting cancels debounce work and rejects released callbacks, including the same path", async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "tuxedo-observation-")));
	directories.push(directory);
	const subscriptions: { path: string; signal: () => void; released: boolean }[] = [];
	const changes: TodoFileChange[] = [];
	const backend = createSessionBackend(
		join(directory, "workspaces.json"),
		{
			observe: (path, signal) =>
				Effect.acquireRelease(
					Effect.sync(() => {
						const subscription = { path, signal, released: false };
						subscriptions.push(subscription);
						return subscription;
					}),
					(subscription) =>
						Effect.sync(() => {
							subscription.released = true;
						})
				).pipe(Effect.asVoid),
		},
		(event) => changes.push(event)
	);
	backends.push(backend);
	const firstPath = join(directory, "first.todo");
	const secondPath = join(directory, "second.todo");
	await writeFile(firstPath, "First");
	await writeFile(secondPath, "Second");
	const first = await backend.createWorkspace({
		name: "First",
		color: "blue",
		todoPath: firstPath,
	});
	if (first.status !== "applied" || first.confirmed.session.status !== "ready")
		throw Error("Expected Ready");
	await writeFile(firstPath, "External first");
	subscriptions[0].signal();
	await backend.createWorkspace({ name: "Second", color: "green", todoPath: secondPath });
	expect(subscriptions[0].released).toBe(true);
	await backend.switchWorkspace({
		workspaceId: first.confirmed.session.catalogue.active_workspace_id!,
	});
	await writeFile(firstPath, "Latest first");
	subscriptions[0].signal();
	subscriptions[1].signal();
	await new Promise((resolve) => setTimeout(resolve, 350));
	expect(changes).toEqual([]);
	subscriptions[2].signal();
	await expect.poll(() => changes.length).toBe(1);
	const restored = await backend.restoreSession({});
	expect(restored.session).toMatchObject({
		status: "ready",
		todo_file: { items: [{ description: "Latest first" }] },
	});
	await writeFile(firstPath, "After disposal");
	subscriptions.at(-1)!.signal();
	await backend.dispose();
	for (const subscription of subscriptions) subscription.signal();
	await new Promise((resolve) => setTimeout(resolve, 350));
	expect(subscriptions.every((subscription) => subscription.released)).toBe(true);
	expect(changes).toHaveLength(1);
});

test.each(["failure", "defect"])(
	"partially acquired observation resources close after %s without rejecting session operations",
	async (failure) => {
		const directory = await realpath(await mkdtemp(join(tmpdir(), "tuxedo-observation-")));
		directories.push(directory);
		const path = join(directory, "active.todo");
		await writeFile(path, "First");
		let subscriptions = 0;
		const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
		const backend = createSessionBackend(join(directory, "workspaces.json"), {
			observe: () =>
				Effect.gen(function* () {
					yield* Effect.acquireRelease(
						Effect.sync(() => {
							subscriptions++;
						}),
						() =>
							Effect.sync(() => {
								subscriptions--;
							})
					);
					yield* failure === "failure"
						? Effect.fail("Cannot observe")
						: Effect.die("Cannot observe");
				}),
		});
		backends.push(backend);
		const created = await backend.createWorkspace({ name: "Work", color: "blue", todoPath: path });
		expect(created.status).toBe("applied");
		expect(subscriptions).toBe(0);
		expect(diagnostic).toHaveBeenCalled();
		if (created.status !== "applied" || created.confirmed.session.status !== "ready")
			throw Error("Expected Ready");
		const outcome = await backend.createTodo({
			scope: created.confirmed.scope,
			revision: created.confirmed.revision,
			workspaceId: created.confirmed.session.catalogue.active_workspace_id!,
			description: "Second",
			projects: [],
			contexts: [],
		});
		expect(outcome.status).toBe("applied");
		expect(subscriptions).toBe(0);
		expect((await backend.restoreSession({})).session).toMatchObject({
			status: "ready",
			todo_file: { items: [{ description: "First" }, { description: "Second" }] },
		});
	}
);

test("debounced signals are suppressed while restoration is busy and release in unavailable", async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "tuxedo-observation-")));
	directories.push(directory);
	const path = join(directory, "active.todo");
	const cataloguePath = join(directory, "workspaces.json");
	await writeFile(path, "First");
	let signal!: () => void;
	let subscribed = false;
	let pause = false;
	let reading = false;
	let resume!: () => void;
	const gate = new Promise<void>((resolve) => {
		resume = resolve;
	});
	const changes: TodoFileChange[] = [];
	const backend = createSessionBackend(
		cataloguePath,
		{
			observe: (_path, changed) =>
				Effect.acquireRelease(
					Effect.sync(() => {
						signal = changed;
						subscribed = true;
					}),
					() =>
						Effect.sync(() => {
							subscribed = false;
						})
				),
		},
		(event) => changes.push(event),
		{
			filesystem: {
				...filesystem,
				readFile: (file) =>
					Effect.gen(function* () {
						if (pause && file === path) {
							reading = true;
							yield* Effect.promise(() => gate);
						}
						return yield* filesystem.readFile(file);
					}),
			},
		}
	);
	backends.push(backend);
	await backend.createWorkspace({ name: "Work", color: "blue", todoPath: path });
	await writeFile(path, "External edit");
	pause = true;
	const restore = backend.restoreSession({});
	try {
		await expect.poll(() => reading).toBe(true);
		signal();
		await new Promise((resolve) => setTimeout(resolve, 350));
		expect(changes).toEqual([]);
	} finally {
		resume();
	}
	expect((await restore).session).toMatchObject({
		status: "ready",
		todo_file: { items: [{ description: "External edit" }] },
	});
	await writeFile(cataloguePath, "invalid");
	expect((await backend.restoreSession({})).session.status).toBe("unavailable");
	expect(subscribed).toBe(false);
	signal();
	await new Promise((resolve) => setTimeout(resolve, 350));
	expect(changes).toEqual([]);
});

test("observation release defects do not reject successful Workspace switches", async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "tuxedo-observation-")));
	directories.push(directory);
	const firstPath = join(directory, "first.todo");
	const secondPath = join(directory, "second.todo");
	await writeFile(firstPath, "First");
	await writeFile(secondPath, "Second");
	vi.spyOn(console, "error").mockImplementation(() => {});
	const backend = createSessionBackend(join(directory, "workspaces.json"), {
		observe: () => Effect.acquireRelease(Effect.void, () => Effect.die("release failed")),
	});
	backends.push(backend);
	await backend.createWorkspace({ name: "First", color: "blue", todoPath: firstPath });
	const second = await backend.createWorkspace({
		name: "Second",
		color: "green",
		todoPath: secondPath,
	});
	expect(second).toMatchObject({
		status: "applied",
		confirmed: { session: { todo_file: { path: secondPath } } },
	});
});

test("disposal releases observation resources when admitted restoration finishes", async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "tuxedo-observation-")));
	directories.push(directory);
	const path = join(directory, "active.todo");
	await writeFile(path, "First");
	let subscribed = false;
	let pause = false;
	let reading = false;
	let resume!: () => void;
	const gate = new Promise<void>((resolve) => {
		resume = resolve;
	});
	const backend = createSessionBackend(
		join(directory, "workspaces.json"),
		{
			observe: () =>
				Effect.acquireRelease(
					Effect.sync(() => {
						subscribed = true;
					}),
					() =>
						Effect.sync(() => {
							subscribed = false;
						})
				),
		},
		undefined,
		{
			filesystem: {
				...filesystem,
				readFile: (file) =>
					Effect.gen(function* () {
						if (pause && file === path) {
							reading = true;
							yield* Effect.promise(() => gate);
						}
						return yield* filesystem.readFile(file);
					}),
			},
		}
	);
	backends.push(backend);
	await backend.createWorkspace({ name: "Work", color: "blue", todoPath: path });
	pause = true;
	const restore = backend.restoreSession({});
	let disposal: Promise<void> | undefined;
	let stopping: Promise<void> | undefined;
	try {
		await expect.poll(() => reading).toBe(true);
		stopping = backend.stopObservation();
		disposal = backend.dispose();
	} finally {
		resume();
	}
	const [, disposed, stopped] = await Promise.allSettled([restore, disposal, stopping]);
	expect(disposed.status).toBe("fulfilled");
	expect(stopped.status).toBe("fulfilled");
	expect(subscribed).toBe(false);
});

test("disposal during an observation read releases resources and suppresses the stale event", async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "tuxedo-observation-")));
	directories.push(directory);
	const path = join(directory, "active.todo");
	await writeFile(path, "First");
	let signal!: () => void;
	let subscriptions = 0;
	let pause = false;
	let reading = false;
	let resume!: () => void;
	const gate = new Promise<void>((resolve) => {
		resume = resolve;
	});
	const changes: TodoFileChange[] = [];
	const backend = createSessionBackend(
		join(directory, "workspaces.json"),
		{
			observe: (_path, changed) =>
				Effect.acquireRelease(
					Effect.sync(() => {
						subscriptions++;
						signal = changed;
					}),
					() =>
						Effect.sync(() => {
							subscriptions--;
						})
				),
		},
		(event) => changes.push(event),
		{
			filesystem: {
				...filesystem,
				readFile: (file) =>
					Effect.gen(function* () {
						if (pause && file === path) {
							reading = true;
							yield* Effect.promise(() => gate);
						}
						return yield* filesystem.readFile(file);
					}),
			},
		}
	);
	backends.push(backend);
	await backend.createWorkspace({ name: "Work", color: "blue", todoPath: path });
	await writeFile(path, "External edit");
	pause = true;
	signal();
	let disposal: Promise<void> | undefined;
	try {
		await expect.poll(() => reading).toBe(true);
		disposal = backend.dispose();
		await new Promise((resolve) => setTimeout(resolve, 50));
	} finally {
		resume();
	}
	await disposal;
	expect(subscriptions).toBe(0);
	expect(changes).toEqual([]);
});

test("observation attaches only to confirmed Active Todo files and stops in Empty", async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "tuxedo-observation-")));
	directories.push(directory);
	const paths = new Set<string>();
	const observation: TodoFileObservationAdapter = {
		observe: (path) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					paths.add(path);
				}),
				() =>
					Effect.sync(() => {
						paths.delete(path);
					})
			),
	};
	const backend = createSessionBackend(join(directory, "workspaces.json"), observation);
	backends.push(backend);
	await backend.restoreSession({});
	expect([...paths]).toEqual([]);
	const firstPath = join(directory, "first.todo");
	const secondPath = join(directory, "second.todo");
	await writeFile(firstPath, "First");
	await writeFile(secondPath, "Second");
	const first = await backend.createWorkspace({
		name: "First",
		color: "blue",
		todoPath: firstPath,
	});
	if (first.status !== "applied" || first.confirmed.session.status !== "ready")
		throw Error("Expected Ready");
	expect([...paths]).toEqual([firstPath]);
	await backend.createWorkspace({ name: "Second", color: "green", todoPath: secondPath });
	expect([...paths]).toEqual([secondPath]);
	await backend.switchWorkspace({
		workspaceId: first.confirmed.session.catalogue.active_workspace_id!,
	});
	expect([...paths]).toEqual([firstPath]);
	await rm(firstPath);
	const refreshed = await backend.restoreSession({});
	expect(refreshed.session).toMatchObject({
		status: "empty",
		warning: expect.stringContaining(firstPath),
		catalogue: { workspaces: expect.any(Array) },
	});
	expect([...paths]).toEqual([]);
});

test.each(["atomic replacement", "briefly missing entry", "deletion"] as const)(
	"native observation refreshes through restoration after %s",
	async (change) => {
		const directory = await realpath(await mkdtemp(join(tmpdir(), "tuxedo-observation-")));
		directories.push(directory);
		const observation = createTodoFileObservation();
		const changes: TodoFileChange[] = [];
		const backend = createSessionBackend(
			join(directory, "workspaces.json"),
			observation,
			(event) => {
				changes.push(event);
			}
		);
		try {
			const path = join(directory, "active.todo");
			await writeFile(path, "Original");
			const created = await backend.createWorkspace({
				name: "Work",
				color: "blue",
				todoPath: path,
			});
			if (created.status !== "applied") throw Error("Expected creation");
			await writeFile(join(directory, "inactive.todo"), "Inactive edit");
			if (change === "atomic replacement") {
				await writeFile(
					join(directory, "replacement.todo"),
					"x 2026-10-10 Finished +Home @desk\n(A) Inserted +Work\n2026-13-01 Invalid\n"
				);
				await rename(join(directory, "replacement.todo"), path);
			} else if (change === "briefly missing entry") {
				await rename(path, join(directory, "backup.todo"));
				await writeFile(join(directory, "backup.todo"), "Saved after a brief missing entry\n");
				await rename(join(directory, "backup.todo"), path);
			} else {
				await rm(path);
			}
			// Native watchers can deliver multiple signals for one filesystem change.
			await expect
				.poll(() => changes.some((event) => event.revision === created.confirmed.revision), {
					timeout: 3000,
				})
				.toBe(true);
			expect(changes.find((event) => event.revision === created.confirmed.revision)).toMatchObject({
				scope: created.confirmed.scope,
				revision: created.confirmed.revision,
				todoPath: path,
			});
			const refreshed = await backend.restoreSession({});
			if (change === "deletion") {
				expect(refreshed.session).toMatchObject({
					status: "empty",
					warning: expect.stringContaining(path),
				});
				return;
			}
			if (refreshed.session.status !== "ready") throw Error("Expected Ready");
			if (change === "atomic replacement") {
				expect(refreshed.session.todo_file.items.map((item) => item.description)).toEqual([
					"Finished",
					"Inserted",
				]);
				expect(refreshed.session.todo_file.items[0].completed).toBe(true);
				expect(refreshed.session.todo_file.skipped).toHaveLength(1);
			} else {
				expect(refreshed.session.todo_file.items.map((item) => item.description)).toEqual([
					"Saved after a brief missing entry",
				]);
			}
		} finally {
			await backend.dispose();
		}
	}
);

test("renaming the containing directory refreshes the missing Active Todo-file path into Empty", async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "tuxedo-observation-")));
	directories.push(directory);
	const containingDirectory = join(directory, "work");
	await mkdir(containingDirectory);
	const path = join(containingDirectory, "todo.txt");
	await writeFile(path, "Original");
	const observation = createTodoFileObservation();
	let changes = 0;
	const backend = createSessionBackend(
		join(directory, "workspaces.json"),
		observation,
		() => changes++
	);
	try {
		await backend.createWorkspace({ name: "Work", color: "blue", todoPath: path });
		await rename(containingDirectory, join(directory, "moved"));
		await expect.poll(() => changes, { timeout: 3000 }).toBe(1);
		const refreshed = await backend.restoreSession({});
		expect(refreshed.session).toMatchObject({
			status: "empty",
			warning: expect.stringContaining(path),
			catalogue: { workspaces: [expect.objectContaining({ todo_path: path })] },
		});
	} finally {
		await backend.dispose();
	}
});

test("observation ignores delayed signals for confirmed contents after own writes", async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "tuxedo-observation-")));
	directories.push(directory);
	let signal!: () => void;
	const changes: TodoFileChange[] = [];
	const backend = createSessionBackend(
		join(directory, "workspaces.json"),
		{
			observe: (_path, changed) =>
				Effect.sync(() => {
					signal = changed;
				}),
		},
		(event) => changes.push(event)
	);
	backends.push(backend);
	const path = join(directory, "active.todo");
	await writeFile(path, "First\nLast");
	const created = await backend.createWorkspace({ name: "Work", color: "blue", todoPath: path });
	if (created.status !== "applied" || created.confirmed.session.status !== "ready")
		throw Error("Expected Ready");
	const reordered = await backend.reorderTodo({
		scope: created.confirmed.scope,
		revision: created.confirmed.revision,
		workspaceId: created.confirmed.session.catalogue.active_workspace_id!,
		lineNumbers: [2, 1],
	});
	expect(reordered.status).toBe("applied");
	signal();
	await new Promise((resolve) => setTimeout(resolve, 350));
	expect(changes).toEqual([]);
	// A real external edit still signals, including a save with the same parsed summary.
	await writeFile(path, "Last\nFirst\n");
	signal();
	await expect.poll(() => changes.length).toBe(1);
});
