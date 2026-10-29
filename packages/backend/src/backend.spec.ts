import { expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { join } from "node:path";
import { WorkspaceSession, workspaceSessionLayer, identityLayer } from "@tuxedo/backend";

layer(NodeFileSystem.layer, { excludeTestServices: true })("backend public operations", (it) => {
	it.effect(
		"a recurring successor starts Unassigned while the original retains its board tokens",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem;
				const directory = yield* fs.makeTempDirectoryScoped();
				const todoPath = join(directory, "todo.txt");
				const original = "Clean rec:1w board:to-do board:future:invalid custom:keep\n";
				yield* fs.writeFileString(todoPath, original);
				yield* Effect.gen(function* () {
					const session = yield* WorkspaceSession;
					const created = yield* session.createWorkspace({ name: "Work", color: "blue", todoPath });
					if (created.status !== "applied" || created.confirmed.session.status !== "ready")
						throw Error("Workspace creation failed");
					const workspaceId = created.confirmed.session.catalogue.active_workspace_id!;
					const item = created.confirmed.session.todo_file.items[0];
					expect(item.metadata.board).toBe("future:invalid");
					const completed = yield* session.setTodoCompletion({
						scope: created.confirmed.scope,
						revision: created.confirmed.revision,
						workspaceId,
						lineNumber: item.line_number,
						expectedRaw: item.raw,
						completed: true,
					});
					if (completed.status !== "applied") throw Error("Completion failed");
					const [source, successor] = completed.confirmed.todo_file.items;
					expect(source.edit.metadata).toContain("board:to-do");
					expect(source.edit.metadata).toContain("board:future:invalid");
					expect(successor.edit.metadata).not.toContain("board:to-do");
					expect(successor.edit.metadata).not.toContain("board:future:invalid");
					expect(successor.metadata).toMatchObject({ rec: "1w", custom: "keep" });
					expect(
						yield* session.undoTodo({
							scope: completed.confirmed.scope,
							revision: completed.confirmed.revision,
							workspaceId,
						})
					).toMatchObject({ status: "applied" });
					expect(yield* fs.readFileString(todoPath)).toBe(original);
				}).pipe(
					Effect.provide(
						workspaceSessionLayer(join(directory, "workspaces.json")).pipe(
							Layer.provide(identityLayer)
						)
					)
				);
			})
	);
	it.effect("an unrelated edit retains malformed and repeated board tokens", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const directory = yield* fs.makeTempDirectoryScoped();
			const todoPath = join(directory, "todo.txt");
			yield* fs.writeFileString(
				todoPath,
				"Plan board:to-do board: board:future:invalid\uFEFF custom:keep\n"
			);
			yield* Effect.gen(function* () {
				const session = yield* WorkspaceSession;
				const created = yield* session.createWorkspace({ name: "Work", color: "blue", todoPath });
				if (created.status !== "applied" || created.confirmed.session.status !== "ready")
					throw Error("Workspace creation failed");
				const item = created.confirmed.session.todo_file.items[0];
				expect(item.edit).toEqual({
					description: "Plan",
					metadata: ["board:to-do", "board:", "board:future:invalid\uFEFF", "custom:keep"],
				});
				const edited = yield* session.editTodo({
					scope: created.confirmed.scope,
					revision: created.confirmed.revision,
					workspaceId: created.confirmed.session.catalogue.active_workspace_id!,
					lineNumber: item.line_number,
					expectedRaw: item.raw,
					description: "Changed plan",
					projects: [],
					contexts: [],
					priority: null,
					creationDate: null,
					completed: false,
					completionDate: null,
					metadata: item.edit.metadata,
				});
				expect(edited.status).toBe("applied");
				expect(yield* fs.readFileString(todoPath)).toBe(
					"Changed plan board:to-do board: board:future:invalid\uFEFF custom:keep\n"
				);
			}).pipe(
				Effect.provide(
					workspaceSessionLayer(join(directory, "workspaces.json")).pipe(
						Layer.provide(identityLayer)
					)
				)
			);
		})
	);
	it.effect(
		"moving a Todo item replaces repeated board values and Undo restores the exact file",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem;
				const directory = yield* fs.makeTempDirectoryScoped();
				const todoPath = join(directory, "todo.txt");
				const original =
					"(A) Plan\tboard:to-do  +Work board:future/2  due:2030-01-01  \r\n\nNext\n";
				yield* fs.writeFileString(todoPath, original);
				yield* Effect.gen(function* () {
					const session = yield* WorkspaceSession;
					const created = yield* session.createWorkspace({ name: "Work", color: "blue", todoPath });
					if (created.status !== "applied" || created.confirmed.session.status !== "ready")
						throw Error("Workspace creation failed");
					const workspaceId = created.confirmed.session.catalogue.active_workspace_id!;
					const moved = yield* session.moveTodoOnBoard({
						scope: created.confirmed.scope,
						revision: created.confirmed.revision,
						workspaceId,
						lineNumber: 1,
						expectedRaw: "(A) Plan\tboard:to-do  +Work board:future/2  due:2030-01-01  ",
						column: "in-progress",
					});
					if (moved.status !== "applied") throw Error("Move failed");
					expect(moved.confirmed.undoLabel).toBe("Undo move");
					expect(yield* fs.readFileString(todoPath)).toBe(
						"(A) Plan\tboard:in-progress  +Work   due:2030-01-01  \r\n\nNext\n"
					);
					expect(
						yield* session.undoTodo({
							scope: moved.confirmed.scope,
							revision: moved.confirmed.revision,
							workspaceId,
						})
					).toMatchObject({ status: "applied" });
					expect(yield* fs.readFileString(todoPath)).toBe(original);
				}).pipe(
					Effect.provide(
						workspaceSessionLayer(join(directory, "workspaces.json")).pipe(
							Layer.provide(identityLayer)
						)
					)
				);
			})
	);
	it.effect("Workspace creation, completion and Undo share one scoped session", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const directory = yield* fs.makeTempDirectoryScoped();
			const todoPath = join(directory, "todo.txt");
			yield* fs.writeFileString(todoPath, "First\r\nLast");
			yield* Effect.gen(function* () {
				const session = yield* WorkspaceSession;
				const created = yield* session.createWorkspace({ name: "Work", color: "blue", todoPath });
				if (created.status !== "applied" || created.confirmed.session.status !== "ready")
					throw Error("Workspace creation failed");
				const workspaceId = created.confirmed.session.catalogue.active_workspace_id!;
				const completed = yield* session.setTodoCompletion({
					scope: created.confirmed.scope,
					revision: created.confirmed.revision,
					workspaceId,
					lineNumber: 1,
					expectedRaw: "First",
					completed: true,
				});
				if (completed.status !== "applied") throw Error("Completion failed");
				expect(completed.confirmed.todo_file.items[0].completed).toBe(true);
				expect(
					yield* session.undoTodo({
						scope: completed.confirmed.scope,
						revision: completed.confirmed.revision,
						workspaceId,
					})
				).toMatchObject({ status: "applied" });
				expect(yield* fs.readFileString(todoPath)).toBe("First\r\nLast");
			}).pipe(
				Effect.provide(
					workspaceSessionLayer(join(directory, "workspaces.json")).pipe(
						Layer.provide(identityLayer)
					)
				)
			);
		})
	);
});
