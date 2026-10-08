import {
	summarizeTodoFile,
	type TodoFileSummary,
} from "$lib/modules/todo/domain/todo-file-summary";
import { WorkspaceSessionState } from "$lib/modules/workspace/state/workspace-session-state.svelte";

import { ElectronWorkspaceSessionState } from "$lib/modules/workspace/state/electron-workspace-session.svelte";

export class AppState {
	workspace: WorkspaceSessionState | ElectronWorkspaceSessionState;
	todos: TodoFileSummary;
	isWorkspaceCreationDialogOpen = $state(false);

	constructor(
		workspace: WorkspaceSessionState | ElectronWorkspaceSessionState = typeof window !==
			"undefined" && window.desktop
			? new ElectronWorkspaceSessionState(window.desktop)
			: new WorkspaceSessionState()
	) {
		this.workspace = workspace;
		this.todos = $derived(summarizeTodoFile(this.workspace.todoFile));
	}

	openWorkspaceCreationDialog = () => {
		this.isWorkspaceCreationDialogOpen = true;
	};
}
