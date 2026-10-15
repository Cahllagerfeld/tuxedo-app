import { Effect } from "effect";
import { Identity } from "./identity";
import { atomicWrite } from "./atomic-write";
import { attempt, OperationFailure, readContents } from "./operation";
import {
	savedViewsFileSchema,
	saveViewRequestSchema,
	deleteViewRequestSchema,
	type SavedView,
	type DesktopRequest,
} from "../../src/lib/shared/desktop/contract";
import type { SessionState } from "./session";

export function createSavedViewOperations(path: string, state: SessionState) {
	const read = () =>
		readContents(path).pipe(
			Effect.flatMap((contents) => attempt(() => savedViewsFileSchema.parse(JSON.parse(contents)))),
			Effect.catchTag("PlatformError", (error) =>
				error.reason._tag === "NotFound"
					? Effect.succeed({ version: 1 as const, views: [] as readonly SavedView[] })
					: Effect.fail(error)
			),
			Effect.mapError(
				() =>
					new OperationFailure({
						message: `Cannot read saved views at ${path}. Restore a valid version-1 file. The file has been preserved.`,
					})
			)
		);
	const requireWorkspace = (workspaceId: string) =>
		Effect.gen(function* () {
			const confirmed = yield* state.read;
			if (
				confirmed.session.status === "unavailable" ||
				!confirmed.session.catalogue.workspaces.some((workspace) => workspace.id === workspaceId)
			)
				return yield* Effect.fail(
					new OperationFailure({ message: "The Workspace no longer exists." })
				);
		});
	const applied = (views: readonly SavedView[]) => ({ status: "applied" as const, views });
	const commit = (views: readonly SavedView[]) =>
		atomicWrite(path, JSON.stringify({ version: 1, views }, null, 2) + "\n").pipe(
			Effect.as(applied(views))
		);
	return {
		read: () => read().pipe(Effect.map((file) => applied(file.views))),
		save: (input: DesktopRequest<"saveView">) =>
			Effect.gen(function* () {
				const request = yield* attempt(() => saveViewRequestSchema.parse(input));
				yield* requireWorkspace(request.workspaceId);
				const file = yield* read();
				if (
					file.views.some(
						(view) =>
							view.workspace_id === request.workspaceId &&
							view.name.toLowerCase() === request.name.toLowerCase()
					)
				)
					return yield* Effect.fail(
						new OperationFailure({
							message: "A saved view with this name already exists in this Workspace.",
						})
					);
				const identity = yield* Identity;
				return yield* commit([
					...file.views,
					{
						id: identity.uuid(),
						workspace_id: request.workspaceId,
						name: request.name,
						filters: request.filters,
					},
				]);
			}),
		delete: (input: DesktopRequest<"deleteView">) =>
			Effect.gen(function* () {
				const request = yield* attempt(() => deleteViewRequestSchema.parse(input));
				yield* requireWorkspace(request.workspaceId);
				const file = yield* read();
				if (
					!file.views.some(
						(view) => view.id === request.viewId && view.workspace_id === request.workspaceId
					)
				)
					return yield* Effect.fail(
						new OperationFailure({ message: "The saved view no longer exists in this Workspace." })
					);
				return yield* commit(file.views.filter((view) => view.id !== request.viewId));
			}),
	};
}
