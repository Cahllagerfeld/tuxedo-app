import { expect, layer } from "@effect/vitest";
import { Context, Effect, Layer, Ref } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { join } from "node:path";
import { identityLayer } from "./identity";
import { OperationFailure } from "./operation";
import { WorkspaceSession, sessionLayer } from "./session";
import {
	WorkspaceCatalogueTestState,
	workspaceCatalogueTestLayer,
} from "./testing/workspace-catalogue";

const fixture = Effect.gen(function* () {
	const fs = yield* FileSystem;
	const directory = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
	const todoPath = join(directory, "todo.txt");
	const cataloguePath = join(directory, "workspaces.json");
	yield* fs.writeFileString(todoPath, "First\n");
	const services = yield* Layer.build(
		sessionLayer(cataloguePath, undefined, () => {}).pipe(
			Layer.provideMerge(workspaceCatalogueTestLayer()),
			Layer.provide(identityLayer)
		)
	);
	return {
		fs,
		todoPath,
		cataloguePath,
		session: Context.get(services, WorkspaceSession),
		state: Context.get(services, WorkspaceCatalogueTestState),
	};
});

layer(NodeFileSystem.layer, { excludeTestServices: true })("session test layers", (it) => {
	it.effect("Workspace lifecycle and Todo-item mutations share the injected catalogue", () =>
		Effect.gen(function* () {
			const { fs, todoPath, cataloguePath, session, state } = yield* fixture;
			const created = yield* session.createWorkspace({ name: "Work", color: "blue", todoPath });
			if (created.status !== "applied" || created.confirmed.session.status !== "ready")
				throw Error("setup");
			expect((yield* Ref.get(state)).catalogue.workspaces).toMatchObject([{ name: "Work" }]);
			expect(
				yield* session.deleteTodo({
					scope: created.confirmed.scope,
					revision: created.confirmed.revision,
					workspaceId: created.confirmed.session.catalogue.active_workspace_id!,
					lineNumber: 1,
					expectedRaw: "First",
				})
			).toMatchObject({ status: "applied" });
			expect(yield* fs.readFileString(todoPath)).toBe("");
			expect(yield* fs.exists(cataloguePath)).toBe(false);
		})
	);

	it.effect("catalogue read failure can recover without rebuilding the session", () =>
		Effect.gen(function* () {
			const { session, state } = yield* fixture;
			yield* Ref.update(state, (current) => ({
				...current,
				readFailure: new OperationFailure({ message: "Read denied" }),
			}));
			expect((yield* session.restoreSession({})).session.status).toBe("unavailable");
			yield* Ref.update(state, (current) => ({ ...current, readFailure: undefined }));
			expect((yield* session.restoreSession({})).session.status).toBe("empty");
		})
	);

	it.effect(
		"failed catalogue persistence preserves confirmed state and permits a later creation",
		() =>
			Effect.gen(function* () {
				const { fs, todoPath, session, state } = yield* fixture;
				const before = yield* session.readSession({});
				yield* Ref.update(state, (current) => ({
					...current,
					writeFailure: new OperationFailure({ message: "Write denied" }),
				}));
				const request = { name: "Work", color: "blue" as const, todoPath };
				expect(yield* session.createWorkspace(request)).toMatchObject({
					status: "rejected",
					message: "Cannot create Workspace: Write denied",
				});
				expect(yield* session.readSession({})).toEqual(before);
				expect((yield* Ref.get(state)).catalogue.workspaces).toEqual([]);
				expect(yield* fs.readFileString(todoPath)).toBe("First\n");
				yield* Ref.update(state, (current) => ({ ...current, writeFailure: undefined }));
				expect(yield* session.createWorkspace(request)).toMatchObject({ status: "applied" });
				expect((yield* Ref.get(state)).catalogue.workspaces).toHaveLength(1);
			})
	);
});
