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
	it.effect("Save-path selection defers creation until a validated Workspace submission", () =>
		Effect.gen(function* () {
			const { fs, todoPath, session, state } = yield* fixture;
			const path = join(todoPath, "..", "work.txt");
			const selected = yield* session.prepareTodoFile(path);
			expect(yield* fs.exists(path)).toBe(false);
			const request = { name: "New", color: "green" as const, ...selected };
			expect(yield* session.createWorkspace({ ...request, name: " " })).toMatchObject({
				status: "rejected",
			});
			expect(yield* fs.exists(path)).toBe(false);
			expect(yield* session.createWorkspace(request)).toMatchObject({
				status: "applied",
				confirmed: { session: { status: "ready", todo_file: { items: [] } } },
			});
			expect(yield* fs.readFileString(path)).toBe("");
			expect((yield* Ref.get(state)).catalogue.workspaces).toMatchObject([
				{ name: "New", color: "green", todo_path: selected.todoPath },
			]);
		})
	);
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
	it.effect(
		"a saved new file survives catalogue failure and explicit retry preserves later edits",
		() =>
			Effect.gen(function* () {
				const { fs, todoPath, session, state } = yield* fixture;
				yield* session.createWorkspace({ name: "Previous", color: "blue", todoPath });
				const before = yield* session.readWorkspaceCatalogue({});
				const selected = yield* session.prepareTodoFile(join(todoPath, "..", "new.txt"));
				const request = { name: "New", color: "green" as const, ...selected };
				yield* Ref.update(state, (current) => ({
					...current,
					writeFailure: new OperationFailure({ message: "Write denied" }),
				}));
				expect(yield* session.createWorkspace(request)).toMatchObject({
					status: "rejected",
					message: expect.stringContaining("file has been preserved"),
				});
				expect(yield* fs.readFileString(selected.todoPath)).toBe("");
				expect(yield* session.readWorkspaceCatalogue({})).toEqual(before);
				yield* Ref.update(state, (current) => ({ ...current, writeFailure: undefined }));
				yield* fs.remove(selected.todoPath);
				yield* fs.symlink(todoPath, selected.todoPath);
				expect(yield* session.createWorkspace(request)).toMatchObject({ status: "rejected" });
				expect(yield* fs.readFileString(todoPath)).toBe("First\n");
				yield* fs.remove(selected.todoPath);
				yield* fs.writeFileString(selected.todoPath, "Written elsewhere\r\n");
				yield* Ref.update(state, (current) => ({ ...current, writeFailure: undefined }));
				expect(yield* session.createWorkspace(request)).toMatchObject({
					status: "applied",
					confirmed: { session: { todo_file: { items: [{ description: "Written elsewhere" }] } } },
				});
				expect(yield* fs.readFileString(selected.todoPath)).toBe("Written elsewhere\r\n");
			})
	);
	for (const exists of [false, true]) {
		it.effect(
			`Save selection cannot use the Workspace catalogue as a Todo file (${exists ? "existing" : "missing"})`,
			() =>
				Effect.gen(function* () {
					const { fs, todoPath, cataloguePath, session, state } = yield* fixture;
					yield* session.createWorkspace({ name: "Previous", color: "blue", todoPath });
					const before = yield* session.readWorkspaceCatalogue({});
					const contents = JSON.stringify((yield* Ref.get(state)).catalogue);
					if (exists) yield* fs.writeFileString(cataloguePath, contents);
					const selected = yield* session.prepareTodoFile(cataloguePath);
					expect(
						yield* session.createWorkspace({ name: "Unsafe", color: "green", ...selected })
					).toMatchObject({ status: "rejected" });
					expect(yield* session.readWorkspaceCatalogue({})).toEqual(before);
					if (exists) expect(yield* fs.readFileString(cataloguePath)).toBe(contents);
					else expect(yield* fs.exists(cataloguePath)).toBe(false);
					const caseVariant = yield* session.prepareTodoFile(
						join(cataloguePath, "..", "Workspaces.JSON")
					);
					expect(
						yield* session.createWorkspace({ name: "Unsafe", color: "green", ...caseVariant })
					).toMatchObject({ status: "rejected" });
					if (exists) expect(yield* fs.readFileString(cataloguePath)).toBe(contents);
					else expect(yield* fs.exists(caseVariant.todoPath)).toBe(false);
				})
		);
	}
	it.effect("an unavailable Save destination preserves the previous session and catalogue", () =>
		Effect.gen(function* () {
			const { fs, todoPath, session, state } = yield* fixture;
			yield* session.createWorkspace({ name: "Previous", color: "blue", todoPath });
			const before = yield* session.readWorkspaceCatalogue({});
			const directory = join(todoPath, "..", "destination");
			yield* fs.makeDirectory(directory);
			const selected = yield* session.prepareTodoFile(join(directory, "new.txt"));
			yield* fs.remove(directory, { recursive: true });
			expect(
				yield* session.createWorkspace({ name: "New", color: "blue", ...selected })
			).toMatchObject({ status: "rejected" });
			expect(yield* fs.exists(selected.todoPath)).toBe(false);
			expect(yield* session.readWorkspaceCatalogue({})).toEqual(before);
			expect((yield* Ref.get(state)).catalogue.workspaces).toHaveLength(1);
		})
	);
	it.effect(
		"replacement requires a current native Save selection and validates duplicates before writing",
		() =>
			Effect.gen(function* () {
				const { fs, todoPath, session } = yield* fixture;
				yield* session.createWorkspace({ name: "Previous", color: "blue", todoPath });
				const path = join(todoPath, "..", "existing.txt");
				yield* fs.writeFileString(path, "Keep me\r\n");
				const selected = yield* session.prepareTodoFile(path);
				expect(yield* fs.readFileString(path)).toBe("Keep me\r\n");
				expect(
					yield* session.createWorkspace({ name: "Previous", color: "blue", ...selected })
				).toMatchObject({ status: "rejected" });
				expect(yield* fs.readFileString(path)).toBe("Keep me\r\n");
				expect(
					yield* session.createWorkspace({
						name: "New",
						color: "blue",
						todoPath: path,
						creationToken: "550e8400-e29b-41d4-a716-446655440000",
					})
				).toMatchObject({ status: "rejected" });
				yield* fs.writeFileString(path, "Changed since selection\n");
				expect(
					yield* session.createWorkspace({ name: "New", color: "blue", ...selected })
				).toMatchObject({ status: "rejected", message: expect.stringContaining("file changed") });
				expect(yield* fs.readFileString(path)).toBe("Changed since selection\n");
				const confirmed = yield* session.prepareTodoFile(path);
				expect(
					yield* session.createWorkspace({ name: "New", color: "blue", ...confirmed })
				).toMatchObject({ status: "applied" });
				expect(yield* fs.readFileString(path)).toBe("");
			})
	);
	it.effect(
		"opening a missing file never creates it, and duplicate canonical references cannot be replaced",
		() =>
			Effect.gen(function* () {
				const { fs, todoPath, session } = yield* fixture;
				const missing = join(todoPath, "..", "missing.txt");
				expect(
					yield* session.createWorkspace({ name: "Missing", color: "blue", todoPath: missing })
				).toMatchObject({ status: "rejected" });
				expect(yield* fs.exists(missing)).toBe(false);
				yield* session.createWorkspace({ name: "Previous", color: "blue", todoPath });
				const alias = join(todoPath, "..", "alias.txt");
				yield* fs.symlink(todoPath, alias);
				const selected = yield* session.prepareTodoFile(alias);
				expect(
					yield* session.createWorkspace({ name: "Duplicate", color: "green", ...selected })
				).toMatchObject({ status: "rejected" });
				expect(yield* fs.readFileString(todoPath)).toBe("First\n");
			})
	);

	it.effect("catalogue read failure can recover without rebuilding the session", () =>
		Effect.gen(function* () {
			const { session, state } = yield* fixture;
			yield* Ref.update(state, (current) => ({
				...current,
				readFailure: new OperationFailure({ message: "Read denied" }),
			}));
			expect(yield* session.readWorkspaceCatalogue({})).toMatchObject({
				status: "rejected",
				message: expect.stringContaining("Check its permissions"),
			});
			yield* Ref.update(state, (current) => ({ ...current, readFailure: undefined }));
			expect(yield* session.readWorkspaceCatalogue({})).toMatchObject({
				status: "ready",
				catalogue: { workspaces: [] },
				selection: null,
			});
		})
	);

	it.effect(
		"failed catalogue persistence preserves confirmed state and permits a later creation",
		() =>
			Effect.gen(function* () {
				const { fs, todoPath, session, state } = yield* fixture;
				const before = yield* session.readWorkspaceCatalogue({});
				yield* Ref.update(state, (current) => ({
					...current,
					writeFailure: new OperationFailure({ message: "Write denied" }),
				}));
				const request = { name: "Work", color: "blue" as const, todoPath };
				expect(yield* session.createWorkspace(request)).toMatchObject({
					status: "rejected",
					message: "Cannot create Workspace: Write denied",
				});
				expect(yield* session.readWorkspaceCatalogue({})).toEqual(before);
				expect((yield* Ref.get(state)).catalogue.workspaces).toEqual([]);
				expect(yield* fs.readFileString(todoPath)).toBe("First\n");
				yield* Ref.update(state, (current) => ({ ...current, writeFailure: undefined }));
				expect(yield* session.createWorkspace(request)).toMatchObject({ status: "applied" });
				expect((yield* Ref.get(state)).catalogue.workspaces).toHaveLength(1);
			})
	);
});
