import { expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { join } from "node:path";
import { WorkspaceSession, workspaceSessionLayer, identityLayer } from "@tuxedo/backend";

const workspaceId = "550e8400-e29b-41d4-a716-446655440000";

layer(NodeFileSystem.layer, { excludeTestServices: true })("repeatable Workspace reads", (it) => {
	it.effect("initial reads return disk data without initializing selection or observation", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const directory = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
			const todoPath = join(directory, "todo.txt");
			const cataloguePath = join(directory, "workspaces.json");
			const catalogue = {
				version: 1,
				active_workspace_id: workspaceId,
				workspaces: [
					{
						id: workspaceId,
						name: "Work",
						color: "blue",
						todo_path: todoPath,
						created_at: "2026-10-21T10:00:00Z",
					},
				],
			};
			yield* fs.writeFileString(todoPath, "First\r\nLast");
			yield* fs.writeFileString(cataloguePath, JSON.stringify(catalogue));
			const observed: string[] = [];
			yield* Effect.gen(function* () {
				const session = yield* WorkspaceSession;
				expect(yield* session.readWorkspaceCatalogue({})).toEqual({
					status: "ready",
					catalogue,
					selection: null,
				});
				for (let n = 0; n < 2; n++) {
					expect(yield* session.readWorkspace({ workspaceId })).toMatchObject({
						status: "ready",
						workspace: catalogue.workspaces[0],
						todo_file: { path: todoPath, items: [{ raw: "First" }, { raw: "Last" }] },
						provenance: { status: "speculative" },
					});
				}
				expect(yield* session.readWorkspaceCatalogue({})).toMatchObject({ selection: null });
				expect(observed).toEqual([]);
				expect(yield* fs.readFileString(cataloguePath)).toBe(JSON.stringify(catalogue));
				const restored = yield* session.readSession({});
				expect(restored.revision).toBe(0);
				expect(observed).toEqual([todoPath]);
			}).pipe(
				Effect.provide(
					workspaceSessionLayer(cataloguePath, {
						observe: (path) =>
							Effect.sync(() => {
								observed.push(path);
							}),
					}).pipe(Layer.provide(identityLayer))
				)
			);
		})
	);

	it.effect(
		"inactive, repeated and failed reads preserve A's receipt, Undo and observation target",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem;
				const directory = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
				const aPath = join(directory, "a.txt");
				const bPath = join(directory, "b.txt");
				const cataloguePath = join(directory, "workspaces.json");
				yield* fs.writeFileString(aPath, "First\r\nLast");
				yield* fs.writeFileString(bPath, "Other\n");
				const observed: string[] = [];
				const released: string[] = [];
				yield* Effect.gen(function* () {
					const session = yield* WorkspaceSession;
					const b = yield* session.createWorkspace({ name: "B", color: "green", todoPath: bPath });
					const a = yield* session.createWorkspace({ name: "A", color: "blue", todoPath: aPath });
					if (
						a.status !== "applied" ||
						a.confirmed.session.status !== "ready" ||
						b.status !== "applied" ||
						b.confirmed.session.status !== "ready"
					)
						throw Error("setup");
					const aId = a.confirmed.session.catalogue.active_workspace_id!;
					const bId = b.confirmed.session.catalogue.active_workspace_id!;
					const completed = yield* session.setTodoCompletion({
						scope: a.confirmed.scope,
						revision: a.confirmed.revision,
						workspaceId: aId,
						lineNumber: 1,
						expectedRaw: "First",
						completed: true,
					});
					if (completed.status !== "applied") throw Error("completion");
					const before = yield* session.readSession({});
					const persisted = yield* fs.readFileString(cataloguePath);
					expect(
						yield* session.deleteTodo({
							scope: before.scope,
							revision: before.revision,
							workspaceId: bId,
							lineNumber: 1,
							expectedRaw: "Other",
						})
					).toMatchObject({ status: "rejected" });
					expect(yield* fs.readFileString(bPath)).toBe("Other\n");
					const acquisitions = [...observed];
					const releases = [...released];
					const selection = {
						scope: before.scope,
						revision: before.revision,
						workspaceId: aId,
						todoPath: aPath,
						undoLabel: "Undo completion",
					};
					for (let n = 0; n < 2; n++) {
						expect(yield* session.readWorkspace({ workspaceId: bId })).toMatchObject({
							status: "ready",
							workspace: { id: bId },
							provenance: { status: "speculative" },
						});
						expect(yield* session.readWorkspace({ workspaceId: aId })).toMatchObject({
							status: "ready",
							provenance: { status: "confirmed", selection },
						});
						expect(yield* session.readWorkspaceCatalogue({})).toMatchObject({
							status: "ready",
							selection,
						});
					}
					expect(yield* session.readWorkspace({ workspaceId })).toMatchObject({
						status: "rejected",
						reason: "workspace",
					});
					yield* fs.remove(bPath, { recursive: true });
					expect(yield* session.readWorkspace({ workspaceId: bId })).toMatchObject({
						status: "rejected",
						reason: "todo-file",
					});
					yield* fs.makeDirectory(bPath);
					expect(yield* session.readWorkspace({ workspaceId: bId })).toMatchObject({
						status: "rejected",
						reason: "todo-file",
					});
					yield* fs.remove(bPath, { recursive: true });
					yield* fs.writeFile(bPath, new Uint8Array([255]));
					expect(yield* session.readWorkspace({ workspaceId: bId })).toMatchObject({
						status: "rejected",
						reason: "todo-file",
					});
					yield* fs.writeFileString(cataloguePath, "corrupt");
					expect(yield* session.readWorkspace({ workspaceId: aId })).toMatchObject({
						status: "rejected",
						reason: "catalogue",
					});
					expect(yield* session.readWorkspaceCatalogue({})).toMatchObject({
						status: "rejected",
						reason: "catalogue",
					});
					expect(yield* fs.readFileString(cataloguePath)).toBe("corrupt");
					yield* fs.writeFileString(cataloguePath, persisted);
					expect(yield* session.readSession({})).toEqual(before);
					expect(yield* fs.readFileString(cataloguePath)).toBe(persisted);
					expect(observed).toEqual(acquisitions);
					expect(released).toEqual(releases);
					const acceptedBytes = yield* fs.readFileString(aPath);
					yield* fs.writeFileString(aPath, "External change\nLast");
					expect(yield* session.readWorkspace({ workspaceId: aId })).toMatchObject({
						status: "ready",
						todo_file: { items: [{ raw: "External change" }, { raw: "Last" }] },
						provenance: { status: "speculative" },
					});
					expect(yield* session.readSession({})).toEqual(before);
					yield* fs.remove(aPath);
					expect(yield* session.readWorkspace({ workspaceId: aId })).toMatchObject({
						status: "rejected",
						reason: "todo-file",
					});
					expect(yield* session.readSession({})).toEqual(before);
					yield* fs.writeFileString(aPath, acceptedBytes);
					expect(
						yield* session.undoTodo({
							scope: before.scope,
							revision: before.revision,
							workspaceId: aId,
						})
					).toMatchObject({ status: "applied" });
					expect(yield* fs.readFileString(aPath)).toBe("First\r\nLast");
				}).pipe(
					Effect.provide(
						workspaceSessionLayer(cataloguePath, {
							observe: (path) =>
								Effect.acquireRelease(
									Effect.sync(() => {
										observed.push(path);
									}),
									() =>
										Effect.sync(() => {
											released.push(path);
										})
								),
						}).pipe(Layer.provide(identityLayer))
					)
				);
				expect(released).toEqual(observed);
			})
	);

	it.effect(
		"failed initial reads and empty catalogue reads can retry without accepting a session",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem;
				const directory = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
				const cataloguePath = join(directory, "workspaces.json");
				const todoPath = join(directory, "todo.txt");
				yield* fs.writeFileString(todoPath, "First");
				yield* Effect.gen(function* () {
					const session = yield* WorkspaceSession;
					expect(yield* session.readWorkspaceCatalogue({})).toEqual({
						status: "ready",
						catalogue: { version: 1, workspaces: [], active_workspace_id: null },
						selection: null,
					});
					expect(yield* fs.exists(cataloguePath)).toBe(false);
					expect(yield* session.readWorkspace({ workspaceId })).toMatchObject({
						status: "rejected",
						reason: "workspace",
					});
					yield* fs.writeFileString(cataloguePath, "broken");
					expect(yield* session.readWorkspaceCatalogue({})).toMatchObject({
						status: "rejected",
						reason: "catalogue",
					});
					expect(yield* session.readWorkspace({ workspaceId })).toMatchObject({
						status: "rejected",
						reason: "catalogue",
					});
					expect(yield* fs.readFileString(cataloguePath)).toBe("broken");
					yield* fs.remove(cataloguePath);
					const created = yield* session.createWorkspace({ name: "A", color: "blue", todoPath });
					expect(created).toMatchObject({ status: "applied", confirmed: { revision: 0 } });
				}).pipe(
					Effect.provide(workspaceSessionLayer(cataloguePath).pipe(Layer.provide(identityLayer)))
				);
			})
	);
});
