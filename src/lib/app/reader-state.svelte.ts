import { summarizeTodoFile } from "$lib/modules/todo/domain/todo-file-summary";
import { TodoFilterState } from "$lib/modules/todo/state/todo-filter.svelte";
import type { WorkspaceCommands } from "$lib/modules/workspace/state/workspace-commands.svelte";
import { createTodoBulkSelection } from "$lib/modules/workspace/ui/todo-bulk-selection.svelte";

class CreationState {
	open = $state(false);
}

import type { Workspace } from "$lib/modules/workspace/domain/workspace";
import type { TodoFile } from "$lib/shared/desktop/todo";

export function createReaderState(
	getWorkspace: () => Workspace | null,
	getTodoFile: () => TodoFile | null,
	commands: WorkspaceCommands
) {
	const workspaceId = $derived(getWorkspace()?.id);
	const todos = $derived(summarizeTodoFile(getTodoFile()));
	const todoFilter = $derived.by(() => {
		workspaceId;
		return new TodoFilterState(() => ({
			items: todos.items,
			sortOrder: getWorkspace()?.sort_order ?? "file",
			showDeferred: getWorkspace()?.show_deferred ?? false,
		}));
	});
	const filteredTodoItems = $derived(todoFilter.filterItems(todos.items));
	const creation = $derived.by(() => {
		workspaceId;
		return new CreationState();
	});
	const bulkSelection = createTodoBulkSelection({
		getWorkspace,
		getTodoFile,
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
