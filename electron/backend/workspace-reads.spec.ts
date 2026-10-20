import { afterEach, expect, test } from "vitest";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend, type SessionDependencies } from "./session-runtime";
import type { TodoFileChange } from "../../src/lib/shared/desktop/contract";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(dependencies: SessionDependencies = {}) {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "tuxedo-reads-")));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	const cataloguePath = join(directory, "workspaces.json");
	const subscriptions: { path: string; signal: () => void; released: boolean }[] = [];
	const changes: TodoFileChange[] = [];
	const backend = createSessionBackend(
		cataloguePath,
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
		(event) => changes.push(event),
		dependencies
	);
	cleanups.push(() => backend.dispose());
	const firstPath = join(directory, "first.txt");
	const secondPath = join(directory, "second.txt");
	await writeFile(firstPath, "First\n");
	await writeFile(secondPath, "Second\n");
	const first = await backend.createWorkspace({
		name: "First",
		color: "blue",
		todoPath: firstPath,
	});
	const second = await backend.createWorkspace({
		name: "Second",
		color: "green",
		todoPath: secondPath,
	});
	if (
		first.status !== "applied" ||
		first.confirmed.session.status !== "ready" ||
		second.status !== "applied" ||
		second.confirmed.session.status !== "ready"
	)
		throw Error("setup");
	const firstId = first.confirmed.session.catalogue.active_workspace_id!;
	const secondId = second.confirmed.session.catalogue.active_workspace_id!;
	const completed = await backend.setTodoCompletion({
		scope: second.confirmed.scope,
		revision: second.confirmed.revision,
		workspaceId: secondId,
		lineNumber: 1,
		expectedRaw: "Second",
		completed: true,
	});
	if (completed.status !== "applied") throw Error("setup completion");
	return {
		backend,
		cataloguePath,
		firstPath,
		secondPath,
		firstId,
		secondId,
		subscriptions,
		changes,
	};
}

test("active Todo-file changes are delivered after an unrelated destination read finishes", async () => {
	const filesystem = await Effect.runPromise(FileSystem.pipe(Effect.provide(NodeFileSystem.layer)));
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let heldPath: string | undefined;
	const { backend, firstPath, secondPath, firstId, secondId, subscriptions, changes } = await setup(
		{
			filesystem: {
				...filesystem,
				readFile: (path) =>
					path === heldPath
						? Effect.promise(() => {
								entered.resolve();
								return release.promise;
							}).pipe(Effect.andThen(filesystem.readFile(path)))
						: filesystem.readFile(path),
			},
		}
	);
	const before = await backend.readSession({});
	heldPath = firstPath;
	const destination = backend.readWorkspace({ workspaceId: firstId });
	try {
		await entered.promise;
		await writeFile(secondPath, "External during preload\n");
		subscriptions.at(-1)!.signal();
		// Keep the read pending beyond the real observation debounce.
		await new Promise((resolve) => setTimeout(resolve, 400));
	} finally {
		release.resolve();
	}
	expect(await destination).toMatchObject({ status: "loaded" });
	await expect
		.poll(() => changes, { timeout: 1000 })
		.toEqual([
			{
				scope: before.scope,
				revision: before.revision,
				workspaceId: secondId,
				todoPath: secondPath,
			},
		]);
	const refreshed = await backend.restoreSession({});
	expect(refreshed.session).toMatchObject({
		status: "ready",
		todo_file: { items: [{ raw: "External during preload" }] },
	});
	expect(refreshed.undoLabel).toBeUndefined();
});

test("repeated destination and session reads preserve Active workspace, revision, Undo and observation", async () => {
	const { backend, cataloguePath, firstPath, firstId, secondId, subscriptions } = await setup();
	const before = await backend.readSession({});
	const persisted = await readFile(cataloguePath, "utf8");
	const observed = subscriptions.at(-1)!;
	const count = subscriptions.length;
	for (let index = 0; index < 3; index++) {
		expect(await backend.readWorkspace({ workspaceId: firstId })).toMatchObject({
			status: "loaded",
			workspace: { id: firstId },
			todo_file: { path: firstPath, items: [{ raw: "First" }] },
		});
		expect(await backend.readSession({})).toEqual(before);
	}
	expect(await readFile(cataloguePath, "utf8")).toBe(persisted);
	expect(subscriptions).toHaveLength(count);
	expect(observed.released).toBe(false);
	expect(before.undoLabel).toBe("Undo completion");
	expect(
		await backend.undoTodo({
			scope: before.scope,
			revision: before.revision,
			workspaceId: secondId,
		})
	).toMatchObject({ status: "applied", confirmed: { todo_file: { items: [{ raw: "Second" }] } } });
	const switched = await backend.switchWorkspace({ workspaceId: firstId });
	expect(switched).toMatchObject({
		status: "applied",
		confirmed: { session: { catalogue: { active_workspace_id: firstId } } },
	});
	if (switched.status !== "applied") throw Error("switch");
	expect(switched.confirmed.undoLabel).toBeUndefined();
	expect(JSON.parse(await readFile(cataloguePath, "utf8")).active_workspace_id).toBe(firstId);
});

test("destination reads before session initialization do not activate or begin observation", async () => {
	const { cataloguePath, firstId } = await setup();
	let observations = 0;
	const backend = createSessionBackend(cataloguePath, {
		observe: () =>
			Effect.sync(() => {
				observations++;
			}),
	});
	cleanups.push(() => backend.dispose());
	const persisted = await readFile(cataloguePath, "utf8");
	for (let index = 0; index < 2; index++)
		expect(await backend.readWorkspace({ workspaceId: firstId })).toMatchObject({
			status: "loaded",
			workspace: { id: firstId },
		});
	expect(observations).toBe(0);
	expect(await readFile(cataloguePath, "utf8")).toBe(persisted);
});

test("failed destination reads preserve confirmed data and persisted catalogue", async () => {
	const { backend, cataloguePath, firstPath, firstId } = await setup();
	const before = await backend.readSession({});
	const persisted = await readFile(cataloguePath, "utf8");
	await rm(firstPath);
	expect(await backend.readWorkspace({ workspaceId: firstId })).toMatchObject({
		status: "rejected",
	});
	expect(
		await backend.readWorkspace({ workspaceId: "9426bd98-a6dd-48eb-b1ab-037d82983ae1" })
	).toMatchObject({ status: "rejected", message: expect.stringContaining("does not exist") });
	expect(await backend.readSession({})).toEqual(before);
	expect(await readFile(cataloguePath, "utf8")).toBe(persisted);
	await writeFile(cataloguePath, "corrupt catalogue");
	expect(await backend.readWorkspace({ workspaceId: firstId })).toMatchObject({
		status: "rejected",
	});
	expect(await readFile(cataloguePath, "utf8")).toBe("corrupt catalogue");
	expect(await backend.readSession({})).toEqual(before);
});

test("destination reads do not refresh authoritative state; external events still restore changed disk contents", async () => {
	const { backend, firstId, secondId, secondPath, subscriptions, changes } = await setup();
	const before = await backend.readSession({});
	if (before.session.status !== "ready") throw Error("Expected Ready fixture");
	await writeFile(secondPath, "External\n");
	expect(await backend.readWorkspace({ workspaceId: secondId })).toMatchObject({
		status: "loaded",
		todo_file: before.session.todo_file,
	});
	expect(await backend.readSession({})).toEqual(before);
	await backend.readWorkspace({ workspaceId: firstId });
	subscriptions.at(-1)!.signal();
	await expect.poll(() => changes.length).toBe(1);
	expect(changes[0]).toMatchObject({
		scope: before.scope,
		revision: before.revision,
		workspaceId: secondId,
	});
	const refreshed = await backend.restoreSession({});
	expect(refreshed.session).toMatchObject({
		status: "ready",
		todo_file: { items: [{ raw: "External" }] },
	});
	expect(refreshed.revision).toBeGreaterThan(before.revision);
	expect(refreshed.undoLabel).toBeUndefined();
	expect(await backend.readWorkspace({ workspaceId: secondId })).toMatchObject({
		status: "loaded",
		todo_file: { items: [{ raw: "External" }] },
	});
});
