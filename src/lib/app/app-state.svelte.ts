import {
	summarizeTodoFile,
	type TodoFileSummary,
} from "$lib/modules/todo/domain/todo-file-summary";
import { WorkspaceState } from "$lib/modules/workspace/state/workspace-state.svelte";

export class AppState {
	workspace: WorkspaceState;
	todos: TodoFileSummary;

	constructor(workspace = new WorkspaceState()) {
		this.workspace = workspace;
		this.todos = $derived(summarizeTodoFile(this.workspace.todoFile));
	}
}
