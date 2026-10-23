import { Effect } from "effect";
import type {
	ConfirmedSession,
	DesktopRequest,
	WorkspaceRead,
	WorkspaceCatalogueRead,
	WorkspaceSelection,
} from "@tuxedo/contracts";
import { readWorkspaceRequestSchema } from "@tuxedo/contracts";
import { attempt } from "./operation";
import { parseTodoFile } from "./todo-file";
import { readWorkspaceCatalogue, readWorkspaceContents } from "./workspace-lifecycle";

function workspaceSelection(current: ConfirmedSession | undefined): WorkspaceSelection | null {
	if (!current) return null;
	return {
		scope: current.scope,
		revision: current.revision,
		workspaceId:
			current.session.status === "ready" ? current.session.catalogue.active_workspace_id : null,
		todoPath: current.session.status === "ready" ? current.session.todo_file.path : null,
		...(current.undoLabel ? { undoLabel: current.undoLabel } : {}),
	};
}

export function createWorkspaceReads(
	cataloguePath: string,
	current: () => { confirmed: ConfirmedSession | undefined; todoContents: string | undefined }
) {
	const catalogue = () =>
		readWorkspaceCatalogue(cataloguePath).pipe(
			Effect.map((catalogue): WorkspaceCatalogueRead => ({
				status: "ready",
				catalogue,
				selection: workspaceSelection(current().confirmed),
			})),
			Effect.catch((error) =>
				Effect.succeed({
					status: "rejected" as const,
					reason: "catalogue" as const,
					message: error.message,
				})
			)
		);
	return {
		catalogue,
		workspace: (request: DesktopRequest<"readWorkspace">) =>
			Effect.gen(function* () {
				const input = yield* attempt(() => readWorkspaceRequestSchema.parse(request));
				const read = yield* catalogue();
				if (read.status === "rejected") return read;
				const workspace = read.catalogue.workspaces.find((w) => w.id === input.workspaceId);
				if (!workspace)
					return {
						status: "rejected" as const,
						reason: "workspace" as const,
						message: "Workspace does not exist.",
					};
				return yield* readWorkspaceContents(workspace.todo_path).pipe(
					Effect.map((contents): WorkspaceRead => {
						const { confirmed, todoContents } = current();
						const selection = workspaceSelection(confirmed);
						// Disk data is actionable only when it still matches authoritative acceptance.
						const matches =
							selection &&
							confirmed?.session.status === "ready" &&
							selection.workspaceId === workspace.id &&
							selection.todoPath === workspace.todo_path &&
							read.catalogue.active_workspace_id === workspace.id &&
							contents === todoContents &&
							JSON.stringify(
								confirmed.session.catalogue.workspaces.find((w) => w.id === workspace.id)
							) === JSON.stringify(workspace);
						return {
							status: "ready",
							workspace,
							todo_file: parseTodoFile(workspace.todo_path, contents),
							provenance: matches ? { status: "confirmed", selection } : { status: "speculative" },
						};
					}),
					Effect.catch((error) =>
						Effect.succeed({
							status: "rejected" as const,
							reason: "todo-file" as const,
							message: error.message,
						})
					)
				);
			}).pipe(
				Effect.catch((error) =>
					Effect.succeed({
						status: "rejected" as const,
						reason: "workspace" as const,
						message: error.message,
					})
				)
			),
	};
}
