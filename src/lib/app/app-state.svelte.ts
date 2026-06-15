import { TodoViewState } from "$lib/modules/todo/state/todo-view-state.svelte";
import { WorkspaceStore } from "$lib/modules/workspace/state/workspace-store.svelte";

export class AppState {
	workspace = new WorkspaceStore();
	todos = new TodoViewState(this.workspace);
}
