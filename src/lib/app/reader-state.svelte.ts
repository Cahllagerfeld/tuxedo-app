import { summarizeTodoFile } from "$lib/modules/todo/domain/todo-file-summary";
import { TodoFilterState } from "$lib/modules/todo/state/todo-filter.svelte";
import type { WorkspaceCommands } from "$lib/modules/workspace/state/workspace-commands.svelte";
import { createTodoBulkSelection } from "$lib/modules/workspace/ui/todo-bulk-selection.svelte";

class CreationState {
	open = $state(false);
}

import type { WorkspaceData } from "$lib/modules/workspace/state/workspace-data.svelte";

export function createReaderState(workspace: WorkspaceData, commands: WorkspaceCommands) {
	const workspaceId = $derived(workspace.activeWorkspace?.id);
	const todos = $derived(summarizeTodoFile(workspace.todoFile));
	const todoFilter = $derived.by(() => {
		workspaceId;
		return new TodoFilterState(() => ({
			items: todos.items,
			sortOrder: workspace.activeWorkspace?.sort_order ?? "file",
			showDeferred: workspace.activeWorkspace?.show_deferred ?? false,
		}));
	});
	const filteredTodoItems = $derived(todoFilter.filterItems(todos.items));
	const creation = $derived.by(() => {
		workspaceId;
		return new CreationState();
	});
	const bulkSelection = createTodoBulkSelection({
		getWorkspace: () => workspace,
		getCommands: () => commands,
		getMatchingItems: () => filteredTodoItems,
		getFilterSignature: () => JSON.stringify(todoFilter.snapshot()),
	});
	return {
		get todoFilter() {
			return todoFilter;
		},
		bulkSelection,
		get todos() {
			return todos;
		},
		get filteredTodoItems() {
			return filteredTodoItems;
		},
		get creationOpen() {
			return creation.open;
		},
		set creationOpen(value: boolean) {
			creation.open = value;
		},
	};
}
