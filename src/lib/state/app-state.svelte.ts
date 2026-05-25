import { TodoFilterState } from "./filter-state.svelte";
import { TodoViewState } from "./todo-view-state.svelte";
import { WorkspaceState } from "./workspace-state.svelte";

export class AppState {
	workspace = new WorkspaceState();
	filters = new TodoFilterState();
	todos = new TodoViewState(this.workspace, this.filters);
}
