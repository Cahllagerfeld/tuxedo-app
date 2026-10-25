import { expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { join } from "node:path";
import { WorkspaceSession, workspaceSessionLayer, identityLayer } from "@tuxedo/backend";

layer(NodeFileSystem.layer, { excludeTestServices: true })("session reads", (it) => {
	it.effect(
		"stable reads preserve revision, Undo and observation; changed disk data is confirmed once",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem;
				const directory = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
				const todoPath = join(directory, "todo.txt");
				yield* fs.writeFileString(todoPath, "First\r\nLast");
				let observations = 0;
				yield* Effect.gen(function* () {
					const session = yield* WorkspaceSession;
					const uninitialized = yield* session.readSession({});
					expect(uninitialized.session.status).toBe("unavailable");
					expect(yield* session.readSession({})).toEqual(uninitialized);
					expect(observations).toBe(0);
					const created = yield* session.createWorkspace({ name: "Work", color: "blue", todoPath });
					if (created.status !== "applied" || created.confirmed.session.status !== "ready")
						throw Error("setup");
					expect(created.confirmed.revision).toBe(0);
					const workspaceId = created.confirmed.session.catalogue.active_workspace_id!;
					const edited = yield* session.setTodoCompletion({
						scope: created.confirmed.scope,
						revision: created.confirmed.revision,
						workspaceId,
						lineNumber: 1,
						expectedRaw: "First",
						completed: true,
					});
					if (edited.status !== "applied") throw Error("setup completion");
					const stable = yield* session.readSession({});
					expect(stable.revision).toBe(edited.confirmed.revision);
					expect(stable.undoLabel).toBe("Undo completion");
					expect(yield* session.readSession({})).toEqual(stable);
					expect(observations).toBe(1);
					yield* fs.writeFileString(todoPath, "External\r\nLast");
					expect(yield* session.readSession({})).toEqual(stable);
					expect(observations).toBe(1);
					const refreshed = yield* session.refreshSession({});
					expect(refreshed).toMatchObject({
						revision: stable.revision + 1,
						session: {
							status: "ready",
							todo_file: { items: [{ raw: "External" }, { raw: "Last" }] },
						},
					});
					expect(refreshed.undoLabel).toBeUndefined();
					expect(yield* session.readSession({})).toEqual(refreshed);
					expect(observations).toBe(1);
				}).pipe(
					Effect.provide(
						workspaceSessionLayer(join(directory, "workspaces.json"), {
							observe: () =>
								Effect.sync(() => {
									observations++;
								}),
						}).pipe(Layer.provide(identityLayer))
					)
				);
			})
	);
});
