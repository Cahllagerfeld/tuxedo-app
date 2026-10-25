import { expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { join } from "node:path";
import { WorkspaceSession, workspaceSessionLayer, identityLayer } from "@tuxedo/backend";

layer(NodeFileSystem.layer, { excludeTestServices: true })("session reads", (it) => {
	it.effect("Workspace route reads preserve the confirmed session, Undo and observation", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const directory = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
			const cataloguePath = join(directory, "workspaces.json");
			const firstPath = join(directory, "first.txt");
			const secondPath = join(directory, "second.txt");
			yield* fs.writeFileString(firstPath, "First\n");
			yield* fs.writeFileString(secondPath, "Second\n");
			let observations = 0;
			yield* Effect.gen(function* () {
				const session = yield* WorkspaceSession;
				const first = yield* session.createWorkspace({
					name: "First",
					color: "blue",
					todoPath: firstPath,
				});
				const second = yield* session.createWorkspace({
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
				const opened = yield* session.switchWorkspace({ workspaceId: firstId });
				if (opened.status !== "applied") throw Error("setup");
				yield* session.setTodoCompletion({
					scope: opened.confirmed.scope,
					revision: opened.confirmed.revision,
					workspaceId: firstId,
					lineNumber: 1,
					expectedRaw: "First",
					completed: true,
				});
				const before = yield* session.readSession({});
				const catalogueContents = yield* fs.readFileString(cataloguePath);
				const previousObservations = observations;
				const inactive = yield* session.readWorkspace({ workspaceId: secondId });
				expect(inactive).toMatchObject({
					status: "ready",
					workspace: { id: secondId },
					todo_file: { path: secondPath, items: [{ description: "Second" }] },
					confirmation: null,
				});
				const active = yield* session.readWorkspace({ workspaceId: firstId });
				expect(active).toMatchObject({
					status: "ready",
					workspace: { id: firstId },
					todo_file: { path: firstPath, items: [{ completed: true }] },
					confirmation: {
						scope: before.scope,
						revision: before.revision,
						undoLabel: "Undo completion",
					},
				});
				yield* fs.writeFileString(firstPath, "External\n");
				expect(yield* session.readWorkspace({ workspaceId: firstId })).toEqual(active);
				yield* fs.remove(secondPath);
				expect(yield* session.readWorkspace({ workspaceId: secondId })).toMatchObject({
					status: "rejected",
				});
				expect(
					yield* session.readWorkspace({ workspaceId: "550e8400-e29b-41d4-a716-446655440099" })
				).toEqual({ status: "rejected", message: "Workspace does not exist." });
				expect(yield* fs.readFileString(cataloguePath)).toBe(catalogueContents);
				yield* fs.writeFileString(cataloguePath, "corrupt");
				expect(yield* session.readWorkspace({ workspaceId: secondId })).toMatchObject({
					status: "rejected",
				});
				expect(yield* fs.readFileString(cataloguePath)).toBe("corrupt");
				expect(yield* session.readSession({})).toEqual(before);
				expect(observations).toBe(previousObservations);
			}).pipe(
				Effect.provide(
					workspaceSessionLayer(cataloguePath, {
						observe: () =>
							Effect.sync(() => {
								observations++;
							}),
					}).pipe(Layer.provide(identityLayer))
				)
			);
		})
	);
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
