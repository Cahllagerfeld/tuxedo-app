import { expect, layer } from "@effect/vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Deferred, Effect, Fiber } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as PlatformError from "effect/PlatformError";
import { WorkspaceSession } from "./session";
import { createSessionRuntime, desktopSessionBackend } from "./session-runtime";
import type { DesktopRequest } from "../../src/lib/shared/desktop/contract";

const cases = [
	{
		operation: "complete",
		initial: "(A) 2026-01-01 First  \r\n\n2026-13-01 Invalid\nLast",
		expected: "x 2030-01-02 2026-01-01 First pri:A  \r\n\n2026-13-01 Invalid\nLast",
	},
	{
		operation: "uncomplete",
		initial: "x 2026-01-02 2026-01-01 First pri:A  \r\n\n2026-13-01 Invalid\nLast",
		expected: "(A) 2026-01-01 First  \r\n\n2026-13-01 Invalid\nLast",
	},
	{
		operation: "delete",
		initial: "First\r\n\n2026-13-01 Invalid\nLast",
		expected: "\n2026-13-01 Invalid\nLast",
	},
	{
		operation: "reorder",
		initial: "First\r\n\n2026-13-01 Invalid\nx Hidden\r\nLast",
		expected: "Last\r\n\n2026-13-01 Invalid\nx Hidden\r\nFirst",
	},
] as const;
type MutationCase = (typeof cases)[number];

const setup = (initial: string, filesystem: FileSystem) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const directory = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
		const todoPath = join(directory, "todo.txt");
		const cataloguePath = join(directory, "workspaces.json");
		yield* fs.writeFileString(todoPath, initial.replace("2026-13-01 Invalid", "Valid"));
		yield* fs.chmod(todoPath, 0o664);
		const runtime = yield* Effect.acquireRelease(
			Effect.sync(() =>
				createSessionRuntime(cataloguePath, undefined, undefined, {
					filesystem,
					identity: {
						uuid: randomUUID,
						now: () => new Date(2030, 0, 2, 0, 30).toISOString(),
					},
				})
			),
			(runtime) => Effect.promise(() => runtime.dispose())
		);
		const backend = desktopSessionBackend(runtime);
		const created = yield* Effect.promise(() =>
			backend.createWorkspace({ name: "Work", color: "blue", todoPath })
		);
		if (created.status !== "applied" || created.confirmed.session.status !== "ready")
			throw Error(`setup failed: ${JSON.stringify(created)}`);
		yield* fs.writeFileString(todoPath, initial);
		const restored = yield* Effect.promise(() => backend.restoreSession({}));
		if (restored.session.status !== "ready") throw Error("restoration failed");
		const confirmed = { ...restored, session: restored.session };
		const target = {
			scope: confirmed.scope,
			revision: confirmed.revision,
			workspaceId: confirmed.session.catalogue.active_workspace_id!,
			lineNumber: 1,
			expectedRaw: confirmed.session.todo_file.items[0].raw,
		};
		return { directory, todoPath, cataloguePath, runtime, backend, confirmed, target };
	});

function mutation(
	operation: MutationCase["operation"],
	target: DesktopRequest<"deleteTodo">,
	lastLine: number
) {
	return WorkspaceSession.use((session) => {
		switch (operation) {
			case "complete":
			case "uncomplete":
				return session.setTodoCompletion({ ...target, completed: operation === "complete" });
			case "delete":
				return session.deleteTodo(target);
			case "reorder":
				return session.reorderTodo({
					scope: target.scope,
					revision: target.revision,
					workspaceId: target.workspaceId,
					lineNumbers: [lastLine, 1],
				});
		}
	});
}

layer(NodeFileSystem.layer, { excludeTestServices: true })("Todo-item Effect mutations", (it) => {
	it.effect(
		"failed Undo retains confirmed data and its slot, cleans temporary files, and can be retried",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem;
				let fail = false;
				const { directory, todoPath, cataloguePath, backend, target } = yield* setup(
					"First\r\nLast",
					{
						...fs,
						rename: (from, to) =>
							fail
								? Effect.fail(
										PlatformError.systemError({
											_tag: "PermissionDenied",
											module: "FileSystem",
											method: "rename",
											description: "replacement denied",
										})
									)
								: fs.rename(from, to),
					}
				);
				const catalogue = yield* fs.readFile(cataloguePath);
				const deleted = yield* Effect.promise(() => backend.deleteTodo(target));
				if (deleted.status !== "applied") throw Error("Deletion failed");
				const undoTarget = {
					scope: deleted.confirmed.scope,
					revision: deleted.confirmed.revision,
					workspaceId: target.workspaceId,
				};
				const before = yield* Effect.promise(() => backend.readSession({}));
				fail = true;
				expect(yield* Effect.promise(() => backend.undoTodo(undoTarget))).toMatchObject({
					status: "rejected",
					message: expect.stringContaining("replacement denied"),
				});
				expect(yield* Effect.promise(() => backend.readSession({}))).toEqual(before);
				expect(yield* fs.readFileString(todoPath)).toBe("Last");
				expect((yield* fs.readDirectory(directory)).sort()).toEqual([
					"todo.txt",
					"workspaces.json",
				]);
				fail = false;
				expect(yield* Effect.promise(() => backend.undoTodo(undoTarget))).toMatchObject({
					status: "applied",
				});
				expect(yield* fs.readFileString(todoPath)).toBe("First\r\nLast");
				expect((yield* fs.stat(todoPath)).mode & 0o777).toBe(0o664);
				expect(yield* fs.readFile(cataloguePath)).toEqual(catalogue);
			})
	);
	it.effect("Undo confirms its restore despite interruption and rejects a queued stale Undo", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const entered = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			let block = false;
			const { todoPath, runtime, backend, target } = yield* setup("First\r\nLast", {
				...fs,
				rename: (from, to) =>
					block && to.endsWith("todo.txt")
						? Deferred.succeed(entered, undefined).pipe(
								Effect.andThen(Deferred.await(release)),
								Effect.andThen(fs.rename(from, to))
							)
						: fs.rename(from, to),
			});
			const deleted = yield* Effect.promise(() => backend.deleteTodo(target));
			if (deleted.status !== "applied") throw Error("Deletion failed");
			block = true;
			const effect = WorkspaceSession.use((session) =>
				session.undoTodo({
					scope: deleted.confirmed.scope,
					revision: deleted.confirmed.revision,
					workspaceId: target.workspaceId,
				})
			);
			yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
			const writing = runtime.runFork(effect);
			yield* Deferred.await(entered);
			const queued = runtime.runPromise(effect);
			const interrupting = yield* Effect.forkChild(Fiber.interrupt(writing), {
				startImmediately: true,
			});
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(interrupting);
			expect(yield* Effect.promise(() => queued)).toMatchObject({ status: "rejected" });
			expect(yield* fs.readFileString(todoPath)).toBe("First\r\nLast");
			const confirmed = yield* Effect.promise(() => backend.readSession({}));
			expect(confirmed.undoLabel).toBeUndefined();
			expect(confirmed.revision).toBeGreaterThan(deleted.confirmed.revision);
		})
	);
	it.effect.each(cases)(
		"$operation preserves permissions, exact bytes, and confirmed data",
		(row) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem;
				const { directory, todoPath, cataloguePath, runtime, backend, target, confirmed } =
					yield* setup(row.initial, fs);
				const catalogue = yield* fs.readFile(cataloguePath);
				const outcome = yield* Effect.promise(() =>
					runtime.runPromise(mutation(row.operation, target, row.operation === "reorder" ? 5 : 4))
				);
				expect(outcome.status).toBe("applied");
				if (outcome.status !== "applied") throw Error("mutation failed");
				expect(yield* fs.readFile(todoPath)).toEqual(Buffer.from(row.expected));
				expect((yield* fs.stat(todoPath)).mode & 0o777).toBe(0o664);
				expect(yield* fs.readFile(cataloguePath)).toEqual(catalogue);
				expect((yield* fs.readDirectory(directory)).sort()).toEqual([
					"todo.txt",
					"workspaces.json",
				]);
				expect(yield* Effect.promise(() => backend.readSession({}))).toEqual({
					...confirmed,
					revision: outcome.confirmed.revision,
					undoLabel: outcome.confirmed.undoLabel,
					session: { ...confirmed.session, todo_file: outcome.confirmed.todo_file },
				});
				expect(outcome.confirmed).toMatchObject({
					scope: target.scope,
					workspaceId: target.workspaceId,
				});
				expect(outcome.confirmed.revision).toBeGreaterThan(target.revision);
			})
	);

	it.effect.each(cases)(
		"$operation cleans a failed replacement and can subsequently succeed",
		(row) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem;
				let fail = false;
				const { directory, todoPath, runtime, backend, target, confirmed } = yield* setup(
					row.initial,
					{
						...fs,
						rename: (from, to) =>
							fail
								? Effect.fail(
										PlatformError.systemError({
											_tag: "PermissionDenied",
											module: "FileSystem",
											method: "rename",
											description: "replacement denied",
										})
									)
								: fs.rename(from, to),
					}
				);
				const effect = mutation(row.operation, target, row.operation === "reorder" ? 5 : 4);
				fail = true;
				expect(yield* Effect.promise(() => runtime.runPromise(effect))).toMatchObject({
					status: "rejected",
					message: expect.stringContaining("replacement denied"),
				});
				expect(yield* fs.readFileString(todoPath)).toBe(row.initial);
				expect(yield* Effect.promise(() => backend.readSession({}))).toEqual(confirmed);
				expect((yield* fs.readDirectory(directory)).sort()).toEqual([
					"todo.txt",
					"workspaces.json",
				]);
				fail = false;
				expect(yield* Effect.promise(() => runtime.runPromise(effect))).toMatchObject({
					status: "applied",
				});
				expect(yield* fs.readFileString(todoPath)).toBe(row.expected);
			})
	);

	it.effect.each(cases)("$operation rejects an externally changed Workspace path", (row) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const { directory, todoPath, cataloguePath, runtime, backend, target, confirmed } =
				yield* setup(row.initial, fs);
			const otherPath = join(directory, "other.txt");
			yield* fs.writeFileString(otherPath, row.initial);
			const catalogue = {
				...confirmed.session.catalogue,
				workspaces: confirmed.session.catalogue.workspaces.map((workspace) => ({
					...workspace,
					todo_path: otherPath,
				})),
			};
			yield* fs.writeFileString(cataloguePath, JSON.stringify(catalogue));
			expect(
				yield* Effect.promise(() =>
					runtime.runPromise(mutation(row.operation, target, row.operation === "reorder" ? 5 : 4))
				)
			).toMatchObject({
				status: "rejected",
				message: expect.stringContaining("Active workspace changed"),
			});
			expect(yield* fs.readFileString(todoPath)).toBe(row.initial);
			expect(yield* fs.readFileString(otherPath)).toBe(row.initial);
			expect(yield* Effect.promise(() => backend.readSession({}))).toEqual(confirmed);
		})
	);

	it.effect.each(cases)(
		"$operation confirms its commit despite interruption and rejects a queued stale mutation",
		(row) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem;
				const entered = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const { directory, todoPath, runtime, backend, target, confirmed } = yield* setup(
					row.initial,
					{
						...fs,
						rename: (from, to) =>
							to.endsWith("todo.txt")
								? Deferred.succeed(entered, undefined).pipe(
										Effect.andThen(Deferred.await(release)),
										Effect.andThen(fs.rename(from, to))
									)
								: fs.rename(from, to),
					}
				);
				const effect = mutation(row.operation, target, row.operation === "reorder" ? 5 : 4);
				yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
				const writing = runtime.runFork(effect);
				yield* Deferred.await(entered);
				const queued = runtime.runPromise(effect);
				const interrupting = yield* Effect.forkChild(Fiber.interrupt(writing), {
					startImmediately: true,
				});
				yield* Deferred.succeed(release, undefined);
				yield* Fiber.join(interrupting);
				expect(yield* Effect.promise(() => queued)).toMatchObject({ status: "rejected" });
				expect(yield* fs.readFile(todoPath)).toEqual(Buffer.from(row.expected));
				const accepted = yield* Effect.promise(() => backend.readSession({}));
				expect(accepted.revision).toBeGreaterThan(confirmed.revision);
				expect(accepted.session).toMatchObject({
					status: "ready",
					catalogue: confirmed.session.catalogue,
					todo_file: { path: todoPath },
				});
				if (accepted.session.status !== "ready") throw Error("confirmation lost");
				expect(accepted.session.todo_file.items.map((item) => item.raw)).toEqual(
					row.expected.split(/\r?\n/).filter((raw) => raw && raw !== "2026-13-01 Invalid")
				);
				expect((yield* fs.readDirectory(directory)).sort()).toEqual([
					"todo.txt",
					"workspaces.json",
				]);
			})
	);
});
