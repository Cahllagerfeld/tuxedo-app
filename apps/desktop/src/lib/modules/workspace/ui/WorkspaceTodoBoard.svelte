<script lang="ts">
	import TodoBoard from "#lib/modules/todo/ui/TodoBoard.svelte";
	import { getWorkspaceTodoReader } from "./workspace-todo-reader-context.js";

	const context = getWorkspaceTodoReader();
</script>

<div bind:this={context.viewport} tabindex="-1" class="h-full min-h-0 outline-none">
	<TodoBoard
		bind:this={context.surface}
		items={context.filteredTodoItems}
		today={context.todoFilter.today}
		disabled={context.workspace.writesBlocked}
		selectedTodo={context.reader.selectedTodo}
		onOpen={context.reader.select}
		onToggleComplete={context.toggleTodoCompletion}
		onMove={context.moveTodoOnBoard}
		onReorderColumn={context.reorderTodosOnBoard}
	/>
</div>
