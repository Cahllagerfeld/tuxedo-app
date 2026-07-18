import {
	summarizeTodoFile,
	type TodoFileSummary,
} from "$lib/modules/todo/domain/todo-file-summary";
import { TodoState, type TodoMutationAdapter } from "$lib/modules/todo/state/todo-state.svelte";
import { WorkspaceState } from "$lib/modules/workspace/state/workspace-state.svelte";

export class AppState {
	workspace: WorkspaceState;
	todo: TodoState;
	todos: TodoFileSummary;
	isWorkspaceCreationDialogOpen = $state(false);

	constructor(workspace = new WorkspaceState(), todoAdapter?: TodoMutationAdapter) {
		this.workspace = workspace;
		this.todo = new TodoState(workspace, todoAdapter);
		this.todos = $derived(summarizeTodoFile(this.workspace.todoFile));
	}

	openWorkspaceCreationDialog = () => {
		this.isWorkspaceCreationDialogOpen = true;
	};
}
