import { readConfirmation } from "./testing/read-confirmation";
import { expect, layer } from "@effect/vitest";
import { TestClock } from "effect/testing";
import { Deferred, Effect, Layer, Fiber } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { join } from "node:path";
import { WorkspaceSession, workspaceSessionLayer, identityLayer } from "@tuxedo/backend";
import type { TodoFileChange } from "@tuxedo/contracts";

layer(NodeFileSystem.layer, { excludeTestServices: true })("authoritative observation", (it) => {
	it.effect("a change notification already has an actionable route read and invalidates Undo", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const directory = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
			const todoPath = join(directory, "todo.txt");
			yield* fs.writeFileString(todoPath, "First\n");
			let signal!: () => void;
			const received = yield* Deferred.make<TodoFileChange>();
			yield* Effect.gen(function* () {
				const session = yield* WorkspaceSession;
				const created = yield* session.createWorkspace({ name: "Work", color: "blue", todoPath });
				if (created.status !== "applied" || created.confirmed.session.status !== "ready")
					throw Error("setup");
				const workspaceId = created.confirmed.session.catalogue.active_workspace_id!;
				yield* session.setTodoCompletion({
					scope: created.confirmed.scope,
					revision: created.confirmed.revision,
					workspaceId,
					lineNumber: 1,
					expectedRaw: "First",
					completed: true,
				});
				yield* fs.writeFileString(todoPath, "External\n");
				signal();
				const event = yield* Deferred.await(received);
				expect(yield* session.readWorkspace({ workspaceId })).toMatchObject({
					status: "ready",
					todo_file: { items: [{ description: "External" }] },
					provenance: { status: "confirmed", selection: { revision: event.revision } },
				});
				expect((yield* readConfirmation(session)).undoLabel).toBeUndefined();
			}).pipe(
				Effect.provide(
					workspaceSessionLayer(
						join(directory, "workspaces.json"),
						{
							observe: (_path, changed) =>
								Effect.sync(() => {
									signal = changed;
								}),
						},
						(event) => Deferred.doneUnsafe(received, Effect.succeed(event))
					).pipe(Layer.provide(identityLayer))
				)
			);
		})
	);
});

layer(NodeFileSystem.layer)("observation during admitted work", (it) => {
	it.effect("accounts for a debounced signal while another operation owns the semaphore", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const directory = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
			const todoPath = join(directory, "todo.txt");
			yield* fs.writeFileString(todoPath, "Original\n");
			const reading = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const received = yield* Deferred.make<TodoFileChange>();
			let pause = false;
			let signal!: () => void;
			yield* Effect.gen(function* () {
				const session = yield* WorkspaceSession;
				const created = yield* session.createWorkspace({ name: "Work", color: "blue", todoPath });
				if (created.status !== "applied" || created.confirmed.session.status !== "ready")
					throw Error("setup");
				const workspaceId = created.confirmed.session.catalogue.active_workspace_id!;
				pause = true;
				const operation = yield* session.readWorkspace({ workspaceId }).pipe(Effect.forkChild);
				yield* Deferred.await(reading);
				yield* fs.writeFileString(todoPath, "External during work\n");
				signal();
				yield* TestClock.adjust("250 millis");
				yield* Deferred.succeed(release, undefined);
				yield* Fiber.join(operation);
				yield* Deferred.await(received);
				expect(yield* session.readWorkspace({ workspaceId })).toMatchObject({
					status: "ready",
					todo_file: { items: [{ raw: "External during work" }] },
					provenance: { status: "confirmed" },
				});
			}).pipe(
				Effect.provide(
					workspaceSessionLayer(
						join(directory, "workspaces.json"),
						{
							observe: (_path, changed) =>
								Effect.sync(() => {
									signal = changed;
								}),
						},
						(event) => Deferred.doneUnsafe(received, Effect.succeed(event))
					).pipe(
						Layer.provide(identityLayer),
						Layer.provide(
							Layer.succeed(FileSystem, {
								...fs,
								readFile: (path) =>
									Effect.gen(function* () {
										const contents = yield* fs.readFile(path);
										if (pause && path === todoPath) {
											pause = false;
											yield* Deferred.succeed(reading, undefined);
											yield* Deferred.await(release);
										}
										return contents;
									}),
							})
						)
					)
				)
			);
		})
	);
});
