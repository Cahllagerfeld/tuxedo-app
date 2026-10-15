import {
	summarizeTodoFile,
	type TodoFileSummary,
} from "$lib/modules/todo/domain/todo-file-summary";
import { TodoFilterState } from "$lib/modules/todo/state/todo-filter.svelte";

import { ElectronWorkspaceSessionState } from "$lib/modules/workspace/state/electron-workspace-session.svelte";

export class AppState {
	workspace: ElectronWorkspaceSessionState;
	todos: TodoFileSummary;
	todoFilter = new TodoFilterState();
	filteredTodoItems: ReturnType<TodoFilterState["filterItems"]>;
	isWorkspaceCreationDialogOpen = $state(false);
	isWorkspaceSwitcherOpen = $state(false);
	isTodoCreationOpen = $state(false);

	constructor(
		workspace: ElectronWorkspaceSessionState = new ElectronWorkspaceSessionState(window.desktop)
	) {
		this.workspace = workspace;
		this.todos = $derived(summarizeTodoFile(this.workspace.todoFile));
		this.filteredTodoItems = $derived(this.todoFilter.filterItems(this.todos.items));
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
}
