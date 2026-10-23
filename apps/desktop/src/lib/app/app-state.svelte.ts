import {
	summarizeTodoFile,
	type TodoFileSummary,
} from "$lib/modules/todo/domain/todo-file-summary";
import { TodoFilterState } from "$lib/modules/todo/state/todo-filter.svelte";

import { WorkspaceCommands } from "$lib/modules/workspace/state/workspace-commands.svelte";
import { createTodoBulkSelection } from "$lib/modules/workspace/ui/todo-bulk-selection.svelte";

export class AppState {
	workspace: WorkspaceCommands;
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

	constructor(workspace: WorkspaceCommands) {
		this.workspace = workspace;
		this.todos = $derived(summarizeTodoFile(this.workspace.todoFile));
		this.todoFilter = new TodoFilterState(
			() => this.todos.items,
			() => this.workspace.activeWorkspace ?? {}
		);
		this.filteredTodoItems = $derived(this.todoFilter.filterItems(this.todos.items));
		this.bulkSelection = createTodoBulkSelection({
			getWorkspace: () => this.workspace,
			getMatchingItems: () => this.filteredTodoItems,
			getFilterSignature: () => JSON.stringify(this.todoFilter.snapshot()),
		});
		let previousWorkspace: string | null = null;
		// Route publication is external; only a confirmed reader reconciles ephemeral filters.
		$effect(() => {
			if (!this.workspace.todoFile) return;
			const id = this.workspace.activeWorkspace?.id ?? null;
			if (id !== previousWorkspace) this.isTodoCreationOpen = false;
			previousWorkspace = id;
			this.todoFilter.sync(id);
		});
	}

	openWorkspaceCreationDialog = () => {
		this.isWorkspaceCreationDialogOpen = true;
	};

	showsDestination = (workspaceId: string | undefined) =>
		!!workspaceId &&
		!!this.workspace.todoFile &&
		this.workspace.activeWorkspace?.id === workspaceId;
}
