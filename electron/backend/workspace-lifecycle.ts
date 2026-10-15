import { Data, Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { badArgument, type PlatformError } from "effect/PlatformError";
import { Identity } from "./identity";
import { atomicWrite } from "./atomic-write";
import { decodeTodoContents, parseTodoFile } from "./todo-file";
import {
	catalogueSchema,
	createWorkspaceRequestSchema,
	switchWorkspaceRequestSchema,
	deleteWorkspaceRequestSchema,
	setWorkspaceSortOrderRequestSchema,
	type Catalogue,
	type ConfirmedSession,
	type DesktopRequest,
} from "../../src/lib/shared/desktop/contract";

export type LoadedSession = { session: ConfirmedSession["session"]; todoContents?: string };
export class OperationFailure extends Data.TaggedError("OperationFailure")<{ message: string }> {}
export type OperationError = PlatformError | OperationFailure;
export const attempt = <A>(parse: () => A) =>
	Effect.try({
		try: parse,
		catch: (error) =>
			new OperationFailure({ message: error instanceof Error ? error.message : String(error) }),
	});
export const readContents = (path: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const bytes = yield* fs.readFile(path);
		return yield* Effect.try({
			try: () => decodeTodoContents(bytes),
			catch: (cause) =>
				badArgument({
					module: "FileSystem",
					method: "readFile",
					description: "Invalid UTF-8 file contents",
					cause,
				}),
		});
	});

export function createWorkspaceLifecycle(cataloguePath: string) {
	const unavailable = () => ({
		status: "unavailable" as const,
		error: `Cannot read Workspace catalogue at ${cataloguePath}. Check its permissions or restore a valid version-1 backup. The file has been preserved.`,
	});
	const readCatalogue = () =>
		Effect.gen(function* () {
			const contents = yield* readContents(cataloguePath);
			return yield* attempt(() => catalogueSchema.parse(JSON.parse(contents)));
		}).pipe(
			Effect.catch((error) =>
				error._tag === "PlatformError" && error.reason._tag === "NotFound"
					? Effect.succeed({ version: 1 as const, workspaces: [], active_workspace_id: null })
					: Effect.fail(new OperationFailure({ message: unavailable().error }))
			)
		);
	const projectCatalogue = (
		catalogue: Catalogue
	): Effect.Effect<LoadedSession, never, FileSystem> =>
		Effect.gen(function* () {
			const active = catalogue.workspaces.find((w) => w.id === catalogue.active_workspace_id);
			if (!active) return { session: { status: "empty", catalogue, warning: null } };
			return yield* readContents(active.todo_path).pipe(
				Effect.map((todoContents) => ({
					session: {
						status: "ready" as const,
						catalogue,
						todo_file: parseTodoFile(active.todo_path, todoContents),
					},
					todoContents,
				})),
				Effect.catchTag("PlatformError", () =>
					Effect.succeed({
						session: {
							status: "empty" as const,
							catalogue,
							warning: `Cannot open Todo file at ${active.todo_path}. Check its location and permissions.`,
						},
					})
				)
			);
		});
	const commitCatalogue = (catalogue: Catalogue, loaded: LoadedSession) =>
		atomicWrite(cataloguePath, JSON.stringify(catalogue, null, 2) + "\n").pipe(Effect.as(loaded));
	return {
		setSortOrder: (
			request: DesktopRequest<"setWorkspaceSortOrder">,
			current: ConfirmedSession,
			todoContents: string | undefined
		) =>
			Effect.gen(function* () {
				const input = yield* attempt(() => setWorkspaceSortOrderRequestSchema.parse(request));
				if (
					current.scope !== input.scope ||
					current.revision !== input.revision ||
					current.session.status !== "ready" ||
					current.session.catalogue.active_workspace_id !== input.workspaceId
				)
					return yield* new OperationFailure({
						message: "The Workspace session changed. Try again.",
					});
				const previous = yield* readCatalogue();
				const active = previous.workspaces.find((w) => w.id === input.workspaceId);
				if (
					previous.active_workspace_id !== input.workspaceId ||
					!active ||
					active.todo_path !== current.session.todo_file.path
				)
					return yield* new OperationFailure({ message: "The Active workspace changed." });
				const catalogue = {
					...previous,
					workspaces: previous.workspaces.map((w) =>
						w.id === input.workspaceId ? { ...w, sort_order: input.sortOrder } : w
					),
				};
				return yield* commitCatalogue(catalogue, {
					session: { ...current.session, catalogue },
					todoContents,
				});
			}),
		load: () =>
			readCatalogue().pipe(
				Effect.flatMap(projectCatalogue),
				Effect.catchTag("OperationFailure", () => Effect.succeed({ session: unavailable() }))
			),
		createWorkspace: (request: DesktopRequest<"createWorkspace">) =>
			Effect.gen(function* () {
				const input = yield* attempt(() => createWorkspaceRequestSchema.parse(request));
				const fs = yield* FileSystem;
				const identity = yield* Identity;
				const todoPath = yield* fs.realPath(input.todoPath);
				const todoContents = yield* readContents(todoPath);
				const todo_file = parseTodoFile(todoPath, todoContents);
				if (todo_file.skipped.length)
					return yield* new OperationFailure({
						message: "Cannot create Workspace: Todo file contains skipped lines.",
					});
				const previous = yield* readCatalogue();
				const workspace = {
					id: identity.uuid(),
					name: input.name,
					color: input.color,
					todo_path: todoPath,
					created_at: identity.now(),
				};
				const catalogue = yield* attempt(() =>
					catalogueSchema.parse({
						...previous,
						active_workspace_id: workspace.id,
						workspaces: [...previous.workspaces, workspace],
					})
				);
				return yield* commitCatalogue(catalogue, {
					session: { status: "ready", catalogue, todo_file },
					todoContents,
				});
			}),
		switchWorkspace: (request: DesktopRequest<"switchWorkspace">) =>
			Effect.gen(function* () {
				const { workspaceId } = yield* attempt(() => switchWorkspaceRequestSchema.parse(request));
				const previous = yield* readCatalogue();
				const workspace = previous.workspaces.find((w) => w.id === workspaceId);
				if (!workspace)
					return yield* new OperationFailure({ message: "Workspace does not exist." });
				const todoContents = yield* readContents(workspace.todo_path);
				const todo_file = parseTodoFile(workspace.todo_path, todoContents);
				const catalogue = { ...previous, active_workspace_id: workspaceId };
				return yield* commitCatalogue(catalogue, {
					session: { status: "ready", catalogue, todo_file },
					todoContents,
				});
			}),
		deleteWorkspace: (request: DesktopRequest<"deleteWorkspace">) =>
			Effect.gen(function* () {
				const { workspaceId } = yield* attempt(() => deleteWorkspaceRequestSchema.parse(request));
				const previous = yield* readCatalogue();
				if (!previous.workspaces.some((w) => w.id === workspaceId))
					return yield* new OperationFailure({ message: "Workspace does not exist." });
				const catalogue = yield* attempt(() =>
					catalogueSchema.parse({
						...previous,
						workspaces: previous.workspaces.filter((w) => w.id !== workspaceId),
						active_workspace_id:
							previous.active_workspace_id === workspaceId ? null : previous.active_workspace_id,
					})
				);
				const loaded = yield* projectCatalogue(catalogue);
				return yield* commitCatalogue(catalogue, loaded);
			}),
	};
}
