import {
	summarizeTodoFile,
	type TodoFileSummary,
} from "#lib/modules/todo/domain/todo-file-summary.js";
import { TodoFilterState } from "#lib/modules/todo/state/todo-filter.svelte.js";

import type {
	WorkspaceCommands,
	WorkspaceRoutes,
} from "#lib/modules/workspace/state/workspace-commands.svelte.js";
import type { WorkspaceView } from "#lib/modules/workspace/state/workspace-view.js";
import type { workspaceNavigation } from "./workspace-navigation.svelte.js";
import { createTodoBulkSelection } from "#lib/modules/workspace/ui/todo-bulk-selection.svelte.js";
import { toast } from "svelte-sonner";

export class AppState implements WorkspaceView {
	readonly catalogue: WorkspaceView["catalogue"];
	readonly activeWorkspace: WorkspaceView["activeWorkspace"];
	readonly todoFile: WorkspaceView["todoFile"];
	readonly undoLabel: WorkspaceView["undoLabel"];
	readonly session: WorkspaceView["session"];
	readonly isLoading: boolean;
	todos: TodoFileSummary;
	todoFilter: TodoFilterState;
	filteredTodoItems: ReturnType<TodoFilterState["filterItems"]>;
	isWorkspaceCreationDialogOpen = $state(false);
	isWorkspaceSwitcherOpen = $state(false);
	isTodoCreationOpen = $state(false);
	bulkSelection: ReturnType<typeof createTodoBulkSelection>;
	get todoBulkSelectionActive() {
		return this.bulkSelection.active;
	}

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
		this.todoFilter = new TodoFilterState(
			() => this.todos.items,
			() => this.activeWorkspace ?? {}
		);
		this.filteredTodoItems = $derived(this.todoFilter.filterItems(this.todos.items));
		this.bulkSelection = createTodoBulkSelection({
			getWorkspace: () => this.workspace,
			getData: () => this,
			getMatchingItems: () => this.filteredTodoItems,
			getFilterSignature: () => JSON.stringify(this.todoFilter.snapshot()),
			onInvalidated: (message) => toast.info(message),
		});
		let previousWorkspace: string | null = null;
		// Only a confirmed reader reconciles ephemeral filters after backend updates.
		$effect(() => {
			if (!this.todoFile) return;
			const id = this.activeWorkspace?.id ?? null;
			if (id !== previousWorkspace) this.isTodoCreationOpen = false;
			previousWorkspace = id;
			this.todoFilter.sync(id);
		});
	}

	openWorkspaceCreationDialog = () => {
		this.isWorkspaceCreationDialogOpen = true;
	};

	showsDestination = (workspaceId: string | undefined) =>
		!!workspaceId && !!this.todoFile && this.activeWorkspace?.id === workspaceId;
}
