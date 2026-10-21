import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import { Identity } from "./identity";
import { WorkspaceCatalogue } from "./workspace-catalogue";
import { attempt, OperationFailure, readContents } from "./operation";
import { parseTodoFile } from "./todo-file";
import {
	catalogueSchema,
	createWorkspaceRequestSchema,
	switchWorkspaceRequestSchema,
	deleteWorkspaceRequestSchema,
	setWorkspaceSortOrderRequestSchema,
	setWorkspaceShowDeferredRequestSchema,
	type Catalogue,
	type ConfirmedSession,
	type DesktopRequest,
} from "@tuxedo/contracts";

export type LoadedSession = { session: ConfirmedSession["session"]; todoContents?: string };

function todoFileReadMessage(error: PlatformError): string {
	if (error.reason._tag === "NotFound")
		return "This Todo file couldn’t be found. It may have been moved or deleted.";
	if (error.reason._tag === "PermissionDenied")
		return "Tuxedo doesn’t have permission to read this Todo file. Check its permissions and try again.";
	return "This Todo file couldn’t be opened. Check that it’s a readable plain-text file and try again.";
}

export const readWorkspaceContents = (path: string) =>
	readContents(path).pipe(
		Effect.mapError((error) => new OperationFailure({ message: todoFileReadMessage(error) }))
	);

const unavailableCatalogue = (cataloguePath: string) => ({
	status: "unavailable" as const,
	error: `Cannot read Workspace catalogue at ${cataloguePath}. Check its permissions or restore a valid version-1 backup. The file has been preserved.`,
});
export const readWorkspaceCatalogue = (cataloguePath: string) =>
	WorkspaceCatalogue.use((catalogue) => catalogue.read).pipe(
		Effect.catch((error) =>
			error._tag === "PlatformError" && error.reason._tag === "NotFound"
				? Effect.succeed({ version: 1 as const, workspaces: [], active_workspace_id: null })
				: Effect.fail(new OperationFailure({ message: unavailableCatalogue(cataloguePath).error }))
		)
	);

export function createWorkspaceLifecycle(cataloguePath: string) {
	const readCatalogue = () => readWorkspaceCatalogue(cataloguePath);
	const projectCatalogue = (
		catalogue: Catalogue
	): Effect.Effect<LoadedSession, never, FileSystem> =>
		Effect.gen(function* () {
			const active = catalogue.workspaces.find((w) => w.id === catalogue.active_workspace_id);
			if (!active) return { session: { status: "empty", catalogue, warning: null } };
			return yield* readWorkspaceContents(active.todo_path).pipe(
				Effect.map((todoContents) => ({
					session: {
						status: "ready" as const,
						catalogue,
						todo_file: parseTodoFile(active.todo_path, todoContents),
					},
					todoContents,
				})),
				Effect.catchTag("OperationFailure", (error) =>
					Effect.succeed({
						session: {
							status: "empty" as const,
							catalogue,
							warning: error.message,
						},
					})
				)
			);
		});
	const commitCatalogue = (catalogue: Catalogue, loaded: LoadedSession) =>
		WorkspaceCatalogue.use((store) => store.write(catalogue)).pipe(Effect.as(loaded));
	const savePreferences = Effect.fnUntraced(function* (
		input: Pick<DesktopRequest<"setWorkspaceSortOrder">, "scope" | "revision" | "workspaceId">,
		preferences: Pick<Catalogue["workspaces"][number], "sort_order" | "show_deferred">,
		current: ConfirmedSession,
		todoContents: string | undefined
	) {
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
				w.id === input.workspaceId ? { ...w, ...preferences } : w
			),
		};
		return yield* commitCatalogue(catalogue, {
			session: { ...current.session, catalogue },
			todoContents,
		});
	});
	return {
		setSortOrder: (
			request: DesktopRequest<"setWorkspaceSortOrder">,
			current: ConfirmedSession,
			todoContents: string | undefined
		) =>
			attempt(() => setWorkspaceSortOrderRequestSchema.parse(request)).pipe(
				Effect.flatMap((input) =>
					savePreferences(input, { sort_order: input.sortOrder }, current, todoContents)
				)
			),
		setShowDeferred: (
			request: DesktopRequest<"setWorkspaceShowDeferred">,
			current: ConfirmedSession,
			todoContents: string | undefined
		) =>
			attempt(() => setWorkspaceShowDeferredRequestSchema.parse(request)).pipe(
				Effect.flatMap((input) =>
					savePreferences(input, { show_deferred: input.showDeferred }, current, todoContents)
				)
			),
		load: () =>
			readCatalogue().pipe(
				Effect.flatMap(projectCatalogue),
				Effect.catchTag("OperationFailure", () =>
					Effect.succeed({ session: unavailableCatalogue(cataloguePath) })
				)
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
				const todoContents = yield* readWorkspaceContents(workspace.todo_path);
				const todo_file = parseTodoFile(workspace.todo_path, todoContents);
				const catalogue = { ...previous, active_workspace_id: workspaceId };
				return yield* commitCatalogue(catalogue, {
					session: { status: "ready", catalogue, todo_file },
					todoContents,
				});
			}).pipe(
				Effect.catchTag("PlatformError", () =>
					Effect.fail(
						new OperationFailure({
							message: "This Workspace couldn’t be opened. Please try again.",
						})
					)
				)
			),
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
