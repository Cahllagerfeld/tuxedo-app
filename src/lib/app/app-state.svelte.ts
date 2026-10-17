import {
	summarizeTodoFile,
	type TodoFileSummary,
} from "$lib/modules/todo/domain/todo-file-summary";
import { TodoFilterState } from "$lib/modules/todo/state/todo-filter.svelte";

import { ElectronWorkspaceSessionState } from "$lib/modules/workspace/state/electron-workspace-session.svelte";
import { createTodoBulkSelection } from "$lib/modules/workspace/ui/todo-bulk-selection.svelte";

export class AppState {
	workspace: ElectronWorkspaceSessionState;
	todos: TodoFileSummary;
	todoFilter = new TodoFilterState();
	filteredTodoItems: ReturnType<TodoFilterState["filterItems"]>;
	isWorkspaceCreationDialogOpen = $state(false);
	isWorkspaceSwitcherOpen = $state(false);
	isTodoCreationOpen = $state(false);
	bulkSelection: ReturnType<typeof createTodoBulkSelection>;
	get todoBulkSelectionActive() {
		return this.bulkSelection.active;
	}

	constructor(
		workspace: ElectronWorkspaceSessionState = new ElectronWorkspaceSessionState(window.desktop)
	) {
		this.workspace = workspace;
		this.todos = $derived(summarizeTodoFile(this.workspace.todoFile));
		this.filteredTodoItems = $derived(this.todoFilter.filterItems(this.todos.items));
		this.bulkSelection = createTodoBulkSelection({
			getWorkspace: () => this.workspace,
			getMatchingItems: () => this.filteredTodoItems,
			getFilterSignature: () =>
				JSON.stringify([this.todoFilter.snapshot(), this.todoFilter.showDeferred]),
		});
		$effect(() =>
			this.todoFilter.sync(
				this.workspace.activeWorkspace?.id ?? null,
				this.todos.items,
				this.workspace.activeWorkspace?.sort_order ?? "file",
				this.workspace.activeWorkspace?.show_deferred ?? false
			)
		);
	}

	openWorkspaceCreationDialog = () => {
		this.isWorkspaceCreationDialogOpen = true;
	};

	destinationError = $state("");
	shows = (workspaceId: string | undefined) =>
		!!workspaceId && !this.destinationError && this.workspace.activeWorkspace?.id === workspaceId;
	visitWorkspace = (workspaceId: string) => {
		this.destinationError = "";
		if (this.workspace.activeWorkspace?.id === workspaceId && this.workspace.todoFile) return;
		void this.workspace.open(workspaceId).then((outcome) => {
			if (outcome.status !== "applied") this.destinationError = outcome.message;
		});
	};
}
