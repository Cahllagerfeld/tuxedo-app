import type { TodoFileSummary } from "#lib/modules/todo/domain/todo-file-summary.js";
import { TodoFilterState } from "#lib/modules/todo/state/todo-filter.svelte.js";
import type { WorkspaceCommands } from "../state/workspace-commands.svelte";
import type { WorkspaceView } from "../state/workspace-view";
import { createTodoBulkSelection } from "./todo-bulk-selection.svelte";
import { toast } from "svelte-sonner";

type Source = Pick<WorkspaceView, "activeWorkspace" | "todoFile"> & {
	readonly workspace: WorkspaceCommands;
	readonly todos: TodoFileSummary;
};

export class WorkspaceUiState {
	isWorkspaceCreationDialogOpen = $state(false);
	isWorkspaceSwitcherOpen = $state(false);
	isTodoCreationOpen = $state(false);
	readonly todoFilter: TodoFilterState;
	readonly filteredTodoItems: ReturnType<TodoFilterState["filterItems"]>;
	readonly bulkSelection: ReturnType<typeof createTodoBulkSelection>;

	constructor(source: Source) {
		this.todoFilter = new TodoFilterState(
			() => source.todos.items,
			() => source.activeWorkspace ?? {}
		);
		this.filteredTodoItems = $derived(this.todoFilter.filterItems(source.todos.items));
		this.bulkSelection = createTodoBulkSelection({
			getWorkspace: () => source.workspace,
			getData: () => source,
			getMatchingItems: () => this.filteredTodoItems,
			getFilterSignature: () => JSON.stringify(this.todoFilter.snapshot()),
			onInvalidated: (message) => toast.info(message),
		});
		let previousWorkspace: string | null = null;
		// Only a confirmed reader reconciles ephemeral filters after loader updates.
		$effect(() => {
			if (!source.todoFile) return;
			const id = source.activeWorkspace?.id ?? null;
			if (id !== previousWorkspace) this.isTodoCreationOpen = false;
			previousWorkspace = id;
			this.todoFilter.sync(id);
		});
	}

	openWorkspaceCreationDialog = () => {
		this.isWorkspaceCreationDialogOpen = true;
	};
}
