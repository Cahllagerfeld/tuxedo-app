import type { TodoFile } from "$lib/modules/todo/domain/todo";

export class WorkspaceStore {
	root = $state<string | null>(null);
	todoPath = $state<string | null>(null);
	todoExists = $state(false);
	todoFile = $state.raw<TodoFile | null>(null);
	warning = $state("");
	error = $state("");
	isLoading = $state(false);

	clear() {
		this.root = null;
		this.todoPath = null;
		this.todoExists = false;
		this.todoFile = null;
		this.warning = "";
		this.error = "";
	}
}
