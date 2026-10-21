import { expect, layer } from "@effect/vitest";
import { Context, Effect, Fiber, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { join } from "node:path";
import { WorkspaceSession, workspaceSessionLayer, Identity, identityLayer } from "@tuxedo/backend";

type SessionDependencies = { filesystem?: FileSystem; identity?: Identity["Service"] };

const setup = (dependencies: SessionDependencies = {}) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const directory = yield* fs.makeTempDirectoryScoped();
		const todoPath = join(directory, "todo.txt");
		yield* fs.writeFileString(todoPath, "First\r\nLast");
		const services = yield* Layer.build(
			workspaceSessionLayer(join(directory, "workspaces.json")).pipe(
				Layer.provide(Layer.succeed(FileSystem, dependencies.filesystem ?? fs)),
				Layer.provide(
					dependencies.identity ? Layer.succeed(Identity, dependencies.identity) : identityLayer
				)
			)
		);
		const session = Context.get(services, WorkspaceSession);
		const created = yield* session.createWorkspace({ name: "Work", color: "blue", todoPath });
		if (created.status !== "applied" || created.confirmed.session.status !== "ready")
			throw Error(JSON.stringify(created));
		const target = {
			scope: created.confirmed.scope,
			revision: created.confirmed.revision,
			workspaceId: created.confirmed.session.catalogue.active_workspace_id!,
		};
		const createRequest = {
			...target,
			description: "Added",
			projects: [],
			contexts: [],
			creationDate: null,
		};
		const editRequest = {
			...createRequest,
			lineNumber: 1,
			expectedRaw: "First",
			completed: false,
			completionDate: null,
		};
		const save = (operation: "createTodo" | "editTodo") =>
			operation === "createTodo"
				? session.createTodo(createRequest)
				: session.editTodo(editRequest);
		return {
			fs,
			directory,
			todoPath,
			session,
			services,
			confirmed: created.confirmed,
			target,
			createRequest,
			editRequest,
			save,
		};
	});

layer(NodeFileSystem.layer, { excludeTestServices: true })("Effect Todo-item editor", (it) => {
	it.effect("creation uses the injected local date only when Creation date is omitted", () =>
		Effect.gen(function* () {
			const { fs, todoPath, session, target } = yield* setup({
				identity: {
					uuid: () => crypto.randomUUID(),
					now: () => new Date(2020, 4, 24, 12).toISOString(),
				},
			});
			const first = yield* session.createTodo({
				...target,
				description: "Added",
				projects: [],
				contexts: [],
			});
			expect(first.status).toBe("applied");
			expect(yield* fs.readFileString(todoPath)).toBe("First\r\nLast\r\n2020-05-24 Added");
			if (first.status !== "applied") throw Error("creation failed");
			const second = yield* session.createTodo({
				...target,
				revision: first.confirmed.revision,
				description: "Undated",
				projects: [],
				contexts: [],
				creationDate: null,
			});
			expect(second.status).toBe("applied");
			expect(yield* fs.readFileString(todoPath)).toBe(
				"First\r\nLast\r\n2020-05-24 Added\r\nUndated"
			);
		})
	);

	for (const operation of ["createTodo", "editTodo"] as const) {
		for (const method of ["sync", "rename"] as const) {
			it.effect(
				`${operation}: failed ${method} preserves disk and confirmed data, cleans resources, and permits retry`,
				() =>
					Effect.gen(function* () {
						const fs = yield* FileSystem;
						let fail = false;
						const failure = Effect.fail(
							PlatformError.systemError({
								_tag: "PermissionDenied",
								module: "FileSystem",
								method,
								description: `${method} denied`,
							})
						);
						const fixture = yield* setup({
							filesystem: {
								...fs,
								rename: (from, to) => (fail && method === "rename" ? failure : fs.rename(from, to)),
								open: (path, options) =>
									fs.open(path, options).pipe(
										Effect.map((handle) => {
											const sync = handle.sync;
											return Object.defineProperty(handle, "sync", {
												value: Effect.suspend(() => (fail && method === "sync" ? failure : sync)),
											});
										})
									),
							},
						});
						fail = true;
						expect(yield* fixture.save(operation)).toMatchObject({
							status: "rejected",
							message: expect.stringContaining(`${method} denied`),
						});
						expect(yield* fs.readFileString(fixture.todoPath)).toBe("First\r\nLast");
						expect(yield* fixture.session.readSession({})).toEqual(fixture.confirmed);
						expect((yield* fs.readDirectory(fixture.directory)).sort()).toEqual([
							"todo.txt",
							"workspaces.json",
						]);
						fail = false;
						const outcome = yield* fixture.save(operation);
						expect(outcome.status).toBe("applied");
						if (outcome.status !== "applied") throw Error(outcome.message);
						expect(yield* fs.readFileString(fixture.todoPath)).toBe(
							operation === "createTodo" ? "First\r\nLast\r\nAdded" : "Added\r\nLast"
						);
						expect((yield* fixture.session.readSession({})).revision).toBe(
							outcome.confirmed.revision
						);
					})
			);
		}

		it.effect(
			`${operation}: interruption during replacement cannot split disk commit and confirmation`,
			() =>
				Effect.gen(function* () {
					const fs = yield* FileSystem;
					let entered!: () => void;
					const replacing = new Promise<void>((resolve) => {
						entered = resolve;
					});
					let release!: () => void;
					const gate = new Promise<void>((resolve) => {
						release = resolve;
					});
					const fixture = yield* setup({
						filesystem: {
							...fs,
							rename: (from, to) =>
								to.endsWith("todo.txt")
									? Effect.promise(async () => {
											entered();
											await gate;
										}).pipe(Effect.andThen(fs.rename(from, to)))
									: fs.rename(from, to),
						},
					});
					const saving = yield* Effect.forkScoped(
						WorkspaceSession.use((session) =>
							operation === "createTodo"
								? session.createTodo(fixture.createRequest)
								: session.editTodo(fixture.editRequest)
						).pipe(Effect.provideContext(fixture.services)),
						{ startImmediately: true }
					);
					yield* Effect.promise(() => replacing);
					const interrupted = yield* Effect.forkChild(Fiber.interrupt(saving), {
						startImmediately: true,
					});
					release();
					yield* Fiber.join(interrupted);
					const confirmed = yield* fixture.session.readSession({});
					expect(confirmed.revision).toBeGreaterThan(fixture.confirmed.revision);
					expect(confirmed.session).toMatchObject({
						status: "ready",
						todo_file: {
							items:
								operation === "createTodo"
									? [{ raw: "First" }, { raw: "Last" }, { raw: "Added" }]
									: [{ raw: "Added" }, { raw: "Last" }],
						},
					});
					expect(yield* fs.readFileString(fixture.todoPath)).toBe(
						operation === "createTodo" ? "First\r\nLast\r\nAdded" : "Added\r\nLast"
					);
					expect((yield* fs.readDirectory(fixture.directory)).sort()).toEqual([
						"todo.txt",
						"workspaces.json",
					]);
				})
		);
	}
});
