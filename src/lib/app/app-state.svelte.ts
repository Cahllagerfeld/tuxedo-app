import { TodoViewState } from "$lib/modules/todo/state/todo-view-state.svelte";
import { WorkspaceState } from "$lib/modules/workspace/state/workspace-state.svelte";

export class AppState {
	workspace = new WorkspaceState();
	todos = new TodoViewState(this.workspace);
}
