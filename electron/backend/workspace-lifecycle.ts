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
	type Catalogue,
	type ConfirmedSession,
	type DesktopRequest,
} from "../../src/lib/shared/desktop/contract";

export type LoadedSession = { session: ConfirmedSession["session"]; todoContents?: string };
export class WorkspaceFailure extends Data.TaggedError("WorkspaceFailure")<{ message: string }> {}
export type LifecycleFailure = PlatformError | WorkspaceFailure;
const validate = <A>(parse: () => A) =>
	Effect.try({
		try: parse,
		catch: (error) =>
			new WorkspaceFailure({ message: error instanceof Error ? error.message : String(error) }),
	});
export const readContents = (fs: FileSystem, path: string) =>
	fs.readFile(path).pipe(
		Effect.flatMap((bytes) =>
			Effect.try({
				try: () => decodeTodoContents(bytes),
				catch: (cause) =>
					badArgument({
						module: "FileSystem",
						method: "readFile",
						description: "Invalid UTF-8 file contents",
						cause,
					}),
			})
		)
	);

export function createWorkspaceLifecycle(
	cataloguePath: string,
	fs: FileSystem,
	identity: Identity["Service"]
) {
	const unavailable = () => ({
		status: "unavailable" as const,
		error: `Cannot read Workspace catalogue at ${cataloguePath}. Check its permissions or restore a valid version-1 backup. The file has been preserved.`,
	});
	const readCatalogue = () =>
		Effect.gen(function* () {
			const contents = yield* readContents(fs, cataloguePath);
			return yield* validate(() => catalogueSchema.parse(JSON.parse(contents)));
		}).pipe(
			Effect.catch((error) =>
				error._tag === "PlatformError" && error.reason._tag === "NotFound"
					? Effect.succeed({ version: 1 as const, workspaces: [], active_workspace_id: null })
					: Effect.fail(new WorkspaceFailure({ message: unavailable().error }))
			)
		);
	const projectCatalogue = (catalogue: Catalogue): Effect.Effect<LoadedSession> =>
		Effect.gen(function* () {
			const active = catalogue.workspaces.find((w) => w.id === catalogue.active_workspace_id);
			if (!active) return { session: { status: "empty", catalogue, warning: null } };
			return yield* readContents(fs, active.todo_path).pipe(
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
		atomicWrite(cataloguePath, JSON.stringify(catalogue, null, 2) + "\n").pipe(
			Effect.provideService(FileSystem, fs),
			Effect.provideService(Identity, identity),
			Effect.as(loaded)
		);
	return {
		load: () =>
			readCatalogue().pipe(
				Effect.flatMap(projectCatalogue),
				Effect.catchTag("WorkspaceFailure", () => Effect.succeed({ session: unavailable() }))
			),
		createWorkspace: (request: DesktopRequest<"createWorkspace">) =>
			Effect.gen(function* () {
				const input = yield* validate(() => createWorkspaceRequestSchema.parse(request));
				const todoPath = yield* fs.realPath(input.todoPath);
				const todoContents = yield* readContents(fs, todoPath);
				const todo_file = parseTodoFile(todoPath, todoContents);
				if (todo_file.skipped.length)
					return yield* Effect.fail(
						new WorkspaceFailure({
							message: "Cannot create Workspace: Todo file contains skipped lines.",
						})
					);
				const previous = yield* readCatalogue();
				const workspace = {
					id: identity.uuid(),
					name: input.name,
					color: input.color,
					todo_path: todoPath,
					created_at: identity.now(),
				};
				const catalogue = yield* validate(() =>
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
				const { workspaceId } = yield* validate(() => switchWorkspaceRequestSchema.parse(request));
				const previous = yield* readCatalogue();
				const workspace = previous.workspaces.find((w) => w.id === workspaceId);
				if (!workspace)
					return yield* Effect.fail(new WorkspaceFailure({ message: "Workspace does not exist." }));
				const todoContents = yield* readContents(fs, workspace.todo_path);
				const todo_file = parseTodoFile(workspace.todo_path, todoContents);
				const catalogue = { ...previous, active_workspace_id: workspaceId };
				return yield* commitCatalogue(catalogue, {
					session: { status: "ready", catalogue, todo_file },
					todoContents,
				});
			}),
		deleteWorkspace: (request: DesktopRequest<"deleteWorkspace">) =>
			Effect.gen(function* () {
				const { workspaceId } = yield* validate(() => deleteWorkspaceRequestSchema.parse(request));
				const previous = yield* readCatalogue();
				if (!previous.workspaces.some((w) => w.id === workspaceId))
					return yield* Effect.fail(new WorkspaceFailure({ message: "Workspace does not exist." }));
				const catalogue = yield* validate(() =>
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
