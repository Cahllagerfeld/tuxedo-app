import {
	summarizeTodoFile,
	type TodoFileSummary,
} from "$lib/modules/todo/domain/todo-file-summary";
import { WorkspaceSessionState } from "$lib/modules/workspace/state/workspace-session-state.svelte";

export class AppState {
	workspace: WorkspaceSessionState;
	todos: TodoFileSummary;
	isWorkspaceCreationDialogOpen = $state(false);
	isWorkspaceSwitcherOpen = $state(false);
	isShortcutHelpOpen = $state(false);

	constructor(workspace = new WorkspaceSessionState()) {
		this.workspace = workspace;
		this.todos = $derived(summarizeTodoFile(this.workspace.todoFile));
	}

	openWorkspaceCreationDialog = () => {
		this.isWorkspaceCreationDialogOpen = true;
	};
}
