import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSessionBackend } from "./session-runtime";
import { WorkspaceSession, sessionLayer } from "./session";
import { WorkspaceCatalogue } from "./workspace-catalogue";
import { identityLayer } from "./identity";
import type { Catalogue } from "../../src/lib/shared/desktop/contract";
let nodeFileSystem: FileSystem.FileSystem;
beforeAll(async () => {
	nodeFileSystem = await Effect.runPromise(
		FileSystem.FileSystem.pipe(Effect.provide(NodeFileSystem.layer))
	);
});

const directories: string[] = [];
const backends: ReturnType<typeof createSessionBackend>[] = [];
afterEach(async () => {
	await Promise.all(backends.splice(0).map((backend) => backend.dispose()));
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});

async function setup() {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-lifecycle-"));
	directories.push(directory);
	const todoPath = join(directory, "todo.txt");
	const cataloguePath = join(directory, "workspaces.json");
	await writeFile(todoPath, "First\n");
	return { directory, todoPath, cataloguePath };
}

test("Workspace lifecycle and Todo-item mutations share an injected catalogue with captured dependencies", async () => {
	const { todoPath, cataloguePath } = await setup();
	let catalogue: Catalogue = { version: 1, workspaces: [], active_workspace_id: null };
	const runtime: ManagedRuntime.ManagedRuntime<WorkspaceSession, never> = ManagedRuntime.make(
		sessionLayer(cataloguePath, undefined, () => {}).pipe(
			Layer.provide(
				Layer.succeed(WorkspaceCatalogue, {
					read: Effect.sync(() => catalogue),
					write: (next) =>
						Effect.sync(() => {
							catalogue = next;
						}),
				})
			),
			Layer.provide(Layer.merge(NodeFileSystem.layer, identityLayer))
		)
	);
	try {
		const created = await runtime.runPromise(
			WorkspaceSession.use((session) =>
				session.createWorkspace({ name: "Work", color: "blue", todoPath })
			)
		);
		if (created.status !== "applied" || created.confirmed.session.status !== "ready")
			throw Error("setup");
		expect(catalogue.workspaces).toMatchObject([{ name: "Work" }]);
		const target = {
			scope: created.confirmed.scope,
			revision: created.confirmed.revision,
			workspaceId: created.confirmed.session.catalogue.active_workspace_id!,
			lineNumber: 1,
			expectedRaw: "First",
		};
		expect(
			await runtime.runPromise(WorkspaceSession.use((session) => session.deleteTodo(target)))
		).toMatchObject({ status: "applied" });
		expect(await readFile(todoPath, "utf8")).toBe("");
		await expect(readFile(cataloguePath)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await runtime.dispose();
	}
});

test("injected identity and date persist through Workspace creation and restart", async () => {
	const { todoPath, cataloguePath } = await setup();
	const backend = createSessionBackend(cataloguePath, undefined, undefined, {
		identity: {
			uuid: () => "9426bd98-a6dd-48eb-b1ab-037d82983ae1",
			now: () => "2026-05-24T10:00:00.000Z",
		},
	});
	backends.push(backend);
	const created = await backend.createWorkspace({ name: "Work", color: "blue", todoPath });
	expect(created).toMatchObject({
		status: "applied",
		confirmed: {
			session: {
				catalogue: {
					workspaces: [
						{
							id: "9426bd98-a6dd-48eb-b1ab-037d82983ae1",
							created_at: "2026-05-24T10:00:00.000Z",
						},
					],
				},
			},
		},
	});
	const restarted = createSessionBackend(cataloguePath);
	backends.push(restarted);
	if (created.status !== "applied") throw Error("creation failed");
	expect((await restarted.restoreSession({})).session).toMatchObject({
		status: "ready",
		catalogue: { workspaces: [{ name: "Work" }] },
		todo_file: { items: [{ raw: "First" }] },
	});
});

test("failed replacement preserves disk and confirmed data, cleans temporary files, and allows later operations", async () => {
	const { directory, todoPath, cataloguePath } = await setup();
	let fail = false;
	const backend = createSessionBackend(cataloguePath, undefined, undefined, {
		filesystem: {
			...nodeFileSystem,
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
					: nodeFileSystem.rename(from, to),
		},
	});
	backends.push(backend);
	const first = await backend.createWorkspace({ name: "Work", color: "blue", todoPath });
	if (first.status !== "applied" || first.confirmed.session.status !== "ready")
		throw Error("setup");
	const before = await readFile(cataloguePath, "utf8");
	fail = true;
	const deleted = await backend.deleteWorkspace({
		workspaceId: first.confirmed.session.catalogue.active_workspace_id!,
	});
	expect(deleted).toMatchObject({
		status: "rejected",
		message: expect.stringContaining("replacement denied"),
	});
	expect(await backend.readSession({})).toEqual(first.confirmed);
	expect(await readFile(cataloguePath, "utf8")).toBe(before);
	expect((await readdir(directory)).sort()).toEqual(["todo.txt", "workspaces.json"]);
	fail = false;
	expect(
		await backend.deleteWorkspace({
			workspaceId: first.confirmed.session.catalogue.active_workspace_id!,
		})
	).toMatchObject({ status: "applied", confirmed: { session: { status: "empty" } } });
	expect(await readFile(todoPath, "utf8")).toBe("First\n");
});

test("failed synchronization preserves the catalogue and closes and cleans the temporary file", async () => {
	const { directory, todoPath, cataloguePath } = await setup();
	let fail = false;
	const backend = createSessionBackend(cataloguePath, undefined, undefined, {
		filesystem: {
			...nodeFileSystem,
			open: (path, options) =>
				nodeFileSystem.open(path, options).pipe(
					Effect.map((handle) => {
						const sync = handle.sync;
						return Object.defineProperty(handle, "sync", {
							value: Effect.suspend(() =>
								fail
									? Effect.fail(
											PlatformError.systemError({
												_tag: "PermissionDenied",
												module: "FileSystem",
												method: "sync",
												description: "sync denied",
											})
										)
									: sync
							),
						});
					})
				),
		},
	});
	backends.push(backend);
	const first = await backend.createWorkspace({ name: "Work", color: "blue", todoPath });
	if (first.status !== "applied" || first.confirmed.session.status !== "ready")
		throw Error("setup");
	const before = await readFile(cataloguePath, "utf8");
	fail = true;
	expect(
		await backend.deleteWorkspace({
			workspaceId: first.confirmed.session.catalogue.active_workspace_id!,
		})
	).toMatchObject({ status: "rejected", message: expect.stringContaining("sync denied") });
	expect(await backend.readSession({})).toEqual(first.confirmed);
	expect(await readFile(cataloguePath, "utf8")).toBe(before);
	expect((await readdir(directory)).sort()).toEqual(["todo.txt", "workspaces.json"]);
});

test("legacy Todo-item writes and Workspace lifecycle commands share ordering and recover after rejection", async () => {
	const { todoPath, cataloguePath } = await setup();
	const backend = createSessionBackend(cataloguePath);
	backends.push(backend);
	const created = await backend.createWorkspace({ name: "Work", color: "blue", todoPath });
	if (created.status !== "applied" || created.confirmed.session.status !== "ready")
		throw Error("setup");
	const target = {
		scope: created.confirmed.scope,
		revision: created.confirmed.revision,
		workspaceId: created.confirmed.session.catalogue.active_workspace_id!,
		lineNumber: 1,
		expectedRaw: "First",
	};
	const completed = backend.setTodoCompletion({ ...target, completed: true });
	const failed = backend.switchWorkspace({ workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
	const restored = backend.restoreSession({});
	const stale = backend.deleteTodo(target);
	const read = backend.readSession({});
	expect(await completed).toMatchObject({ status: "applied" });
	expect(await failed).toMatchObject({ status: "rejected" });
	const confirmed = await restored;
	expect(confirmed.session).toMatchObject({
		status: "ready",
		todo_file: { items: [{ completed: true }] },
	});
	expect(await stale).toMatchObject({ status: "rejected" });
	expect(await read).toEqual(confirmed);
	expect(await readFile(todoPath, "utf8")).toMatch(/^x \d{4}-\d{2}-\d{2} First\n$/);
});

test("unexpected lifecycle defects are diagnosed with operation context and safe outcomes", async () => {
	const { todoPath, cataloguePath } = await setup();
	let fail = false;
	const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
	const backend = createSessionBackend(cataloguePath, undefined, undefined, {
		filesystem: {
			...nodeFileSystem,
			realPath: (path) =>
				fail ? Effect.die(Error("private diagnostic detail")) : nodeFileSystem.realPath(path),
		},
	});
	backends.push(backend);
	try {
		const before = await backend.readSession({});
		fail = true;
		expect(await backend.createWorkspace({ name: "Work", color: "blue", todoPath })).toEqual({
			status: "rejected",
			message: "Cannot create Workspace: An unexpected error occurred. Try again.",
		});
		expect(diagnostic.mock.calls.flat().join(" ")).toContain("createWorkspace");
		expect(diagnostic.mock.calls.flat().join(" ")).toContain("private diagnostic detail");
		expect(await backend.readSession({})).toEqual(before);
		await expect(readFile(cataloguePath)).rejects.toMatchObject({ code: "ENOENT" });
		fail = false;
		expect(await backend.createWorkspace({ name: "Work", color: "blue", todoPath })).toMatchObject({
			status: "applied",
		});
	} finally {
		diagnostic.mockRestore();
	}
});

test("runtime disposal lets an admitted catalogue replacement finish before releasing resources", async () => {
	const { todoPath, cataloguePath } = await setup();
	let entered!: () => void;
	const replacing = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const backend = createSessionBackend(cataloguePath, undefined, undefined, {
		filesystem: {
			...nodeFileSystem,
			rename: (from, to) =>
				Effect.promise(async () => {
					entered();
					await gate;
				}).pipe(Effect.andThen(nodeFileSystem.rename(from, to))),
		},
	});
	const creating = backend
		.createWorkspace({ name: "Work", color: "blue", todoPath })
		.catch(() => undefined);
	await replacing;
	const disposed = backend.dispose();
	release();
	await creating;
	await disposed;
	const restarted = createSessionBackend(cataloguePath);
	backends.push(restarted);
	expect((await restarted.restoreSession({})).session).toMatchObject({
		status: "ready",
		catalogue: { workspaces: [{ name: "Work" }] },
		todo_file: { items: [{ raw: "First" }] },
	});
});

test("switching opens the chosen Todo file without loading the previous Active Todo file", async () => {
	const { directory, todoPath, cataloguePath } = await setup();
	const otherPath = join(directory, "other.txt");
	await writeFile(otherPath, "Other\n");
	let previousPath: string | undefined;
	const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
	const backend = createSessionBackend(cataloguePath, undefined, undefined, {
		filesystem: {
			...nodeFileSystem,
			readFile: (path) =>
				path === previousPath
					? Effect.die(Error("The previous Todo file must not be loaded"))
					: nodeFileSystem.readFile(path),
		},
	});
	backends.push(backend);
	try {
		const first = await backend.createWorkspace({ name: "Work", color: "blue", todoPath });
		const second = await backend.createWorkspace({
			name: "Other",
			color: "green",
			todoPath: otherPath,
		});
		if (
			first.status !== "applied" ||
			first.confirmed.session.status !== "ready" ||
			second.status !== "applied" ||
			second.confirmed.session.status !== "ready"
		)
			throw Error("setup");
		previousPath = second.confirmed.session.todo_file.path;
		expect(
			await backend.switchWorkspace({
				workspaceId: first.confirmed.session.catalogue.active_workspace_id!,
			})
		).toMatchObject({
			status: "applied",
			confirmed: { session: { status: "ready", todo_file: { items: [{ raw: "First" }] } } },
		});
	} finally {
		diagnostic.mockRestore();
	}
});

test("Todo-item writes use injected filesystem metadata and preserve confirmed data on failure", async () => {
	const { todoPath, cataloguePath } = await setup();
	const backend = createSessionBackend(cataloguePath, undefined, undefined, {
		filesystem: {
			...nodeFileSystem,
			stat: () =>
				Effect.fail(
					PlatformError.systemError({
						_tag: "PermissionDenied",
						module: "FileSystem",
						method: "stat",
					})
				),
		},
	});
	backends.push(backend);
	const created = await backend.createWorkspace({ name: "Work", color: "blue", todoPath });
	if (created.status !== "applied" || created.confirmed.session.status !== "ready")
		throw Error("setup");
	expect(
		await backend.deleteTodo({
			scope: created.confirmed.scope,
			revision: created.confirmed.revision,
			workspaceId: created.confirmed.session.catalogue.active_workspace_id!,
			lineNumber: 1,
			expectedRaw: "First",
		})
	).toMatchObject({ status: "rejected", message: expect.stringContaining("PermissionDenied") });
	expect(await backend.readSession({})).toEqual(created.confirmed);
	expect(await readFile(todoPath, "utf8")).toBe("First\n");
});
