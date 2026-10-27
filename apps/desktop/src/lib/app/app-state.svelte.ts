import {
	summarizeTodoFile,
	type TodoFileSummary,
} from "#lib/modules/todo/domain/todo-file-summary.js";
import type {
	WorkspaceCommands,
	WorkspaceRoutes,
} from "#lib/modules/workspace/state/workspace-commands.svelte.js";
import type { WorkspaceView } from "#lib/modules/workspace/state/workspace-view.js";
import type { workspaceNavigation } from "./workspace-navigation.svelte.js";

export class AppState implements WorkspaceView {
	readonly catalogue: WorkspaceView["catalogue"];
	readonly activeWorkspace: WorkspaceView["activeWorkspace"];
	readonly todoFile: WorkspaceView["todoFile"];
	readonly undoLabel: WorkspaceView["undoLabel"];
	readonly session: WorkspaceView["session"];
	readonly isLoading: boolean;
	readonly todos: TodoFileSummary;

	constructor(
		readonly workspace: WorkspaceCommands,
		routes: Pick<WorkspaceRoutes, "session" | "workspace" | "destination">,
		readonly navigation: ReturnType<typeof workspaceNavigation>
	) {
		const loadedSession = $derived(routes.session());
		const loadedWorkspace = $derived(routes.workspace());
		const current = $derived(
			loadedWorkspace && loadedWorkspace.workspaceId === routes.destination()
				? loadedWorkspace.value
				: null
		);
		this.session = $derived(
			loadedSession?.value?.session ??
				(loadedSession?.error
					? { status: "unavailable", error: loadedSession.error }
					: { status: "loading" })
		);
		this.catalogue = $derived(
			this.session.status !== "unavailable" && this.session.status !== "loading"
				? this.session.catalogue
				: null
		);
		this.activeWorkspace = $derived(
			this.catalogue?.workspaces.find(
				(workspace) => workspace.id === this.catalogue?.active_workspace_id
			) ?? null
		);
		this.todoFile = $derived(
			current?.confirmation && current.workspace.id === this.catalogue?.active_workspace_id
				? current.todo_file
				: null
		);
		this.undoLabel = $derived(this.todoFile ? current?.confirmation?.undoLabel : undefined);
		this.isLoading = $derived(this.session.status === "loading");
		this.todos = $derived(summarizeTodoFile(this.todoFile));
	}

	showsDestination = (workspaceId: string | undefined) =>
		!!workspaceId && !!this.todoFile && this.activeWorkspace?.id === workspaceId;
}
