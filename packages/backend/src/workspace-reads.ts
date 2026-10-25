import { Effect } from "effect";
import {
	switchWorkspaceRequestSchema,
	type ConfirmedSession,
	type DesktopRequest,
} from "@tuxedo/contracts";
import { attempt, OperationFailure } from "./operation";
import { parseTodoFile } from "./todo-file";
import { readWorkspaceContents } from "./workspace-lifecycle";
import { WorkspaceCatalogue } from "./workspace-catalogue";

export const readWorkspace = (
	request: DesktopRequest<"readWorkspace">,
	current: () => ConfirmedSession | undefined
) =>
	Effect.gen(function* () {
		const { workspaceId } = yield* attempt(() => switchWorkspaceRequestSchema.parse(request));
		const confirmed = current();
		if (
			confirmed?.session.status === "ready" &&
			confirmed.session.catalogue.active_workspace_id === workspaceId
		) {
			return {
				status: "ready" as const,
				workspace: confirmed.session.catalogue.workspaces.find(
					(workspace) => workspace.id === workspaceId
				)!,
				todo_file: confirmed.session.todo_file,
				confirmation: {
					scope: confirmed.scope,
					revision: confirmed.revision,
					...(confirmed.undoLabel ? { undoLabel: confirmed.undoLabel } : {}),
				},
			};
		}
		const catalogue = yield* WorkspaceCatalogue.use((catalogue) => catalogue.read);
		const workspace = catalogue.workspaces.find((workspace) => workspace.id === workspaceId);
		if (!workspace)
			return yield* Effect.fail(new OperationFailure({ message: "Workspace does not exist." }));
		const contents = yield* readWorkspaceContents(workspace.todo_path);
		return {
			status: "ready" as const,
			workspace,
			todo_file: parseTodoFile(workspace.todo_path, contents),
			confirmation: null,
		};
	});
