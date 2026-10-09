import {
	summarizeTodoFile,
	type TodoFileSummary,
} from "$lib/modules/todo/domain/todo-file-summary";

import { ElectronWorkspaceSessionState } from "$lib/modules/workspace/state/electron-workspace-session.svelte";

export class AppState {
	workspace: ElectronWorkspaceSessionState;
	todos: TodoFileSummary;
	isWorkspaceCreationDialogOpen = $state(false);

	constructor(
		workspace: ElectronWorkspaceSessionState = new ElectronWorkspaceSessionState(window.desktop)
	) {
		this.workspace = workspace;
		this.todos = $derived(summarizeTodoFile(this.workspace.todoFile));
	}

	openWorkspaceCreationDialog = () => {
		this.isWorkspaceCreationDialogOpen = true;
	};
}
