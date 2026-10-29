import { readConfirmation } from "./testing/read-confirmation";
import { expect, layer } from "@effect/vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Context, Deferred, Effect, Fiber, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as PlatformError from "effect/PlatformError";
import { WorkspaceSession, workspaceSessionLayer, Identity } from "@tuxedo/backend";
import type { DesktopRequest } from "@tuxedo/contracts";

const cases = [
	{
		operation: "move",
		initial: "First board:unknown\r\n\n2026-13-01 Invalid\nx Hidden\r\nLast",
		expected: "First board:to-do\r\n\n2026-13-01 Invalid\nx Hidden\r\nLast",
	},
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
		operation: "bulk-delete",
		initial: "First\r\n\n2026-13-01 Invalid\nx Hidden\r\nLast",
		expected: "\n2026-13-01 Invalid\nx Hidden\r\n",
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
		const services = yield* Layer.build(
			workspaceSessionLayer(cataloguePath).pipe(
				Layer.provide(Layer.succeed(FileSystem, filesystem)),
				Layer.provide(
					Layer.succeed(Identity, {
						uuid: randomUUID,
						now: () => new Date(2030, 0, 2, 0, 30).toISOString(),
					})
				)
			)
		);
		const session = Context.get(services, WorkspaceSession);
		const created = yield* session.createWorkspace({ name: "Work", color: "blue", todoPath });
		if (created.status !== "applied" || created.confirmed.session.status !== "ready")
			throw Error(`setup failed: ${JSON.stringify(created)}`);
		yield* fs.writeFileString(todoPath, initial);
		const activated = yield* session.switchWorkspace({
			workspaceId: created.confirmed.session.catalogue.active_workspace_id!,
		});
		if (activated.status !== "applied") throw Error("activation failed");
		const restored = activated.confirmed;
		if (restored.session.status !== "ready") throw Error("restoration failed");
		const confirmed = { ...restored, session: restored.session };
		const target = {
			scope: confirmed.scope,
			revision: confirmed.revision,
			workspaceId: confirmed.session.catalogue.active_workspace_id!,
			lineNumber: 1,
			expectedRaw: confirmed.session.todo_file.items[0].raw,
		};
		return { directory, todoPath, cataloguePath, services, session, confirmed, target };
	});

function mutation(
	operation: MutationCase["operation"],
	target: DesktopRequest<"deleteTodo">,
	lastLine: number
) {
	return WorkspaceSession.use((session) => {
		switch (operation) {
			case "move":
				return session.moveTodoOnBoard({ ...target, column: "to-do" });
			case "complete":
			case "uncomplete":
				return session.setTodoCompletion({ ...target, completed: operation === "complete" });
			case "delete":
				return session.deleteTodo(target);
			case "bulk-delete":
				return session.bulkDeleteTodos({
					scope: target.scope,
					revision: target.revision,
					workspaceId: target.workspaceId,
					targets: [
						{ lineNumber: target.lineNumber, expectedRaw: target.expectedRaw },
						{ lineNumber: lastLine, expectedRaw: "Last" },
					],
				});
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
	it.effect("board moves report external conflicts and reject stale targets", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const { todoPath, session, target } = yield* setup("First board:to-do\nx Finished\n", fs);
			yield* fs.writeFileString(todoPath, "Externally changed board:to-do\nx Finished\n");
			const conflict = yield* session.moveTodoOnBoard({ ...target, column: "in-progress" });
			expect(conflict.status).toBe("conflict");
			expect(yield* fs.readFileString(todoPath)).toBe(
				"Externally changed board:to-do\nx Finished\n"
			);
			expect(yield* session.moveTodoOnBoard({ ...target, column: "in-progress" })).toMatchObject({
				status: "rejected",
			});
			if (conflict.status !== "conflict") throw Error("expected conflict");
			expect(conflict.confirmed.todo_file.items[0].raw).toBe("Externally changed board:to-do");
			expect(yield* fs.readFileString(todoPath)).toBe(
				"Externally changed board:to-do\nx Finished\n"
			);
		})
	);
	it.effect(
		"Done completes with recurrence as one undoable change and reopening restores or chooses a column",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem;
				const initial =
					"(B) Chore rec:1w board:to-do/2 custom:keep\r\nx 2029-12-01 Legacy\nx 2029-12-02 Plan board:in-progress\n";
				const { todoPath, session, target } = yield* setup(initial, fs);
				const done = yield* session.moveTodoOnBoard({ ...target, column: "done" });
				if (done.status !== "applied") throw Error("Completion failed");
				expect(done.confirmed.undoLabel).toBe("Undo completion");
				const [source, successor] = done.confirmed.todo_file.items;
				expect(source.raw).toBe(
					"x 2030-01-02 Chore rec:1w board:to-do/2 custom:keep pri:B tuxedo-generated:1"
				);
				expect(successor.raw).not.toContain("board:");
				expect(successor.metadata).toMatchObject({ rec: "1w", custom: "keep" });
				const next = { ...target, scope: done.confirmed.scope };
				const undone = yield* session.undoTodo({
					scope: done.confirmed.scope,
					revision: done.confirmed.revision,
					workspaceId: target.workspaceId,
				});
				if (undone.status !== "applied") throw Error("Undo failed");
				expect(yield* fs.readFileString(todoPath)).toBe(initial);
				const reopened = yield* session.moveTodoOnBoard({
					...next,
					revision: undone.confirmed.revision,
					lineNumber: 2,
					expectedRaw: "x 2029-12-01 Legacy",
					column: "in-progress",
				});
				if (reopened.status !== "applied") throw Error("Reopening failed");
				expect(reopened.confirmed.undoLabel).toBe("Undo move");
				const restored = yield* session.setTodoCompletion({
					...next,
					revision: reopened.confirmed.revision,
					lineNumber: 3,
					expectedRaw: "x 2029-12-02 Plan board:in-progress",
					completed: false,
				});
				expect(restored.status).toBe("applied");
				expect(yield* fs.readFileString(todoPath)).toBe(
					"(B) Chore rec:1w board:to-do/2 custom:keep\r\nLegacy board:in-progress\nPlan board:in-progress\n"
				);
			})
	);
	it.effect(
		"failed Undo retains confirmed data and its slot, cleans temporary files, and can be retried",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem;
				let fail = false;
				const { directory, todoPath, cataloguePath, session, target } = yield* setup(
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
				const deleted = yield* session.deleteTodo(target);
				if (deleted.status !== "applied") throw Error("Deletion failed");
				const undoTarget = {
					scope: deleted.confirmed.scope,
					revision: deleted.confirmed.revision,
					workspaceId: target.workspaceId,
				};
				const before = yield* readConfirmation(session);
				fail = true;
				expect(yield* session.undoTodo(undoTarget)).toMatchObject({
					status: "rejected",
					message: expect.stringContaining("replacement denied"),
				});
				expect(yield* readConfirmation(session)).toEqual(before);
				expect(yield* fs.readFileString(todoPath)).toBe("Last");
				expect((yield* fs.readDirectory(directory)).sort()).toEqual([
					"todo.txt",
					"workspaces.json",
				]);
				fail = false;
				expect(yield* session.undoTodo(undoTarget)).toMatchObject({
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
			const { todoPath, services, session, target } = yield* setup("First\r\nLast", {
				...fs,
				rename: (from, to) =>
					block && to.endsWith("todo.txt")
						? Deferred.succeed(entered, undefined).pipe(
								Effect.andThen(Deferred.await(release)),
								Effect.andThen(fs.rename(from, to))
							)
						: fs.rename(from, to),
			});
			const deleted = yield* session.deleteTodo(target);
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
			const writing = yield* Effect.forkScoped(effect.pipe(Effect.provideContext(services)), {
				startImmediately: true,
			});
			yield* Deferred.await(entered);
			const queued = yield* Effect.forkScoped(effect.pipe(Effect.provideContext(services)), {
				startImmediately: true,
			});
			const interrupting = yield* Effect.forkChild(Fiber.interrupt(writing), {
				startImmediately: true,
			});
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(interrupting);
			expect(yield* Fiber.join(queued)).toMatchObject({ status: "rejected" });
			expect(yield* fs.readFileString(todoPath)).toBe("First\r\nLast");
			const confirmed = yield* readConfirmation(session);
			expect(confirmed.undoLabel).toBeUndefined();
			expect(confirmed.revision).toBeGreaterThan(deleted.confirmed.revision);
		})
	);
	it.effect.each(cases)(
		"$operation preserves permissions, exact bytes, and confirmed data",
		(row) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem;
				const { directory, todoPath, cataloguePath, services, session, target, confirmed } =
					yield* setup(row.initial, fs);
				const catalogue = yield* fs.readFile(cataloguePath);
				const outcome = yield* mutation(row.operation, target, row.initial.split("\n").length).pipe(
					Effect.provideContext(services)
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
				expect(yield* readConfirmation(session)).toEqual({
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
				const { directory, todoPath, services, session, target, confirmed } = yield* setup(
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
				const effect = mutation(row.operation, target, row.initial.split("\n").length);
				fail = true;
				expect(yield* effect.pipe(Effect.provideContext(services))).toMatchObject({
					status: "rejected",
					message: expect.stringContaining("replacement denied"),
				});
				expect(yield* fs.readFileString(todoPath)).toBe(row.initial);
				expect(yield* readConfirmation(session)).toEqual(confirmed);
				expect((yield* fs.readDirectory(directory)).sort()).toEqual([
					"todo.txt",
					"workspaces.json",
				]);
				fail = false;
				expect(yield* effect.pipe(Effect.provideContext(services))).toMatchObject({
					status: "applied",
				});
				expect(yield* fs.readFileString(todoPath)).toBe(row.expected);
			})
	);

	it.effect.each(cases)("$operation rejects an externally changed Workspace path", (row) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const { directory, todoPath, cataloguePath, services, session, target, confirmed } =
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
				yield* mutation(row.operation, target, row.initial.split("\n").length).pipe(
					Effect.provideContext(services)
				)
			).toMatchObject({
				status: "rejected",
				message: expect.stringContaining("Active workspace changed"),
			});
			expect(yield* fs.readFileString(todoPath)).toBe(row.initial);
			expect(yield* fs.readFileString(otherPath)).toBe(row.initial);
			yield* fs.writeFileString(cataloguePath, JSON.stringify(confirmed.session.catalogue));
			expect(yield* readConfirmation(session)).toEqual(confirmed);
		})
	);

	it.effect.each(["missing", "invalid"])(
		"Todo-item deletion rejects a %s catalogue without changing the Todo file or confirmed session",
		(failure) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem;
				const { todoPath, cataloguePath, session, target, confirmed } = yield* setup("First\n", fs);
				if (failure === "missing") yield* fs.remove(cataloguePath);
				else yield* fs.writeFileString(cataloguePath, "invalid");
				expect(yield* session.deleteTodo(target)).toMatchObject({
					status: "rejected",
				});
				expect(yield* fs.readFileString(todoPath)).toBe("First\n");
				if (failure === "missing") expect(yield* fs.exists(cataloguePath)).toBe(false);
				else expect(yield* fs.readFileString(cataloguePath)).toBe("invalid");
				yield* fs.writeFileString(cataloguePath, JSON.stringify(confirmed.session.catalogue));
				expect(yield* readConfirmation(session)).toEqual(confirmed);
			})
	);

	it.effect.each(cases)(
		"$operation confirms its commit despite interruption and rejects a queued stale mutation",
		(row) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem;
				const entered = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const { directory, todoPath, services, session, target, confirmed } = yield* setup(
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
				const effect = mutation(row.operation, target, row.initial.split("\n").length);
				yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
				const writing = yield* Effect.forkScoped(effect.pipe(Effect.provideContext(services)), {
					startImmediately: true,
				});
				yield* Deferred.await(entered);
				const queued = yield* Effect.forkScoped(effect.pipe(Effect.provideContext(services)), {
					startImmediately: true,
				});
				const interrupting = yield* Effect.forkChild(Fiber.interrupt(writing), {
					startImmediately: true,
				});
				yield* Deferred.succeed(release, undefined);
				yield* Fiber.join(interrupting);
				expect(yield* Fiber.join(queued)).toMatchObject({ status: "rejected" });
				expect(yield* fs.readFile(todoPath)).toEqual(Buffer.from(row.expected));
				const accepted = yield* readConfirmation(session);
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
