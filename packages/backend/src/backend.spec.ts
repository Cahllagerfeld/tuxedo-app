import { expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { join } from "node:path";
import { WorkspaceSession, workspaceSessionLayer, identityLayer } from "@tuxedo/backend";

layer(NodeFileSystem.layer, { excludeTestServices: true })("backend public operations", (it) => {
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
