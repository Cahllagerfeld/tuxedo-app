<script lang="ts">
	import TodoList from "#lib/modules/todo/ui/TodoList.svelte";
	import * as Empty from "#lib/shared/ui/empty/index.js";
	import { ScrollArea } from "#lib/shared/ui/scroll-area/index.js";
	import { Button } from "#lib/shared/ui/button/index.js";
	import FileText from "@lucide/svelte/icons/file-text";
	import { toast } from "svelte-sonner";
	import { getWorkspaceTodoReader } from "./workspace-todo-reader-context.js";

	const context = getWorkspaceTodoReader();
</script>

<ScrollArea
	bind:viewportRef={context.viewport}
	class="h-full w-full"
	aria-label="Todo item results"
	viewportTabIndex={-1}
>
	{#if context.view.todoFile}
		{#if context.filteredTodoItems.length === 0 && context.view.todoFile.items.length > 0}
			<Empty.Root aria-label="No matching Todo items" class="min-h-full rounded-none border-0">
				<Empty.Media variant="icon"><FileText aria-hidden="true" /></Empty.Media>
				{#if !context.todoFilter.showDeferred && context.todoFilter.deferredCount > 0}
					<Empty.Header>
						<Empty.Title>Matching Todo items are deferred</Empty.Title>
						<Empty.Description>
							{context.todoFilter.deferredCount} matching {context.todoFilter.deferredCount === 1
								? "Todo item is"
								: "Todo items are"} deferred until a future Show from date.
						</Empty.Description>
					</Empty.Header>
					<Button
						disabled={context.workspace.writesBlocked}
						onclick={() =>
							void context.workspace.setShowDeferred(true).then((outcome) => {
								if (outcome.status === "applied") {
									if (outcome.notice) toast.info(outcome.notice);
								} else
									toast.error("Could not save Show deferred", {
										description: outcome.message,
									});
							})}>Show deferred</Button
					>
				{:else}
					<Empty.Header>
						<Empty.Title>
							No {context.todoFilter.status === "all"
								? ""
								: `${context.todoFilter.status} `}items{context.todoFilter.hasFilters
								? " match these filters"
								: ""}.
						</Empty.Title>
						<Empty.Description>
							{context.todoFilter.hasFilters
								? "Try clearing a filter to see more Todo items."
								: "There are no Todo items in this completion view."}
						</Empty.Description>
					</Empty.Header>
					{#if context.todoFilter.hasFilters}
						<Button disabled={context.workspace.writesBlocked} onclick={context.todoFilter.clear}
							>Clear filters</Button
						>
					{/if}
				{/if}
			</Empty.Root>
		{/if}
		<TodoList
			today={context.todoFilter.today}
			showEmpty={context.view.todoFile.items.length === 0}
			onCreate={context.onCreate}
			bind:this={context.surface}
			fallback={context.viewport}
			workspaceId={context.view.activeWorkspace?.id ?? ""}
			scrollElement={context.viewport}
			todoFile={context.view.todoFile}
			items={context.filteredTodoItems}
			disabled={context.workspace.writesBlocked}
			onToggleComplete={context.selectionMode ? () => {} : context.toggleTodoCompletion}
			onDelete={context.selectionMode ? () => {} : context.deleteTodoItem}
			onEdit={context.selectionMode ? undefined : context.reader.startEdit}
			onReorder={context.selectionMode || context.todoFilter.sortOrder !== "file"
				? undefined
				: context.reorderTodoItems}
			selectedTodo={context.selectionMode ? null : context.reader.selectedTodo}
			onSelect={context.selectionMode ? undefined : context.reader.select}
			onNavigate={context.selectionMode ? undefined : context.reader.navigate}
			selectionMode={context.selectionMode}
			isSelected={context.bulkSelection.isSelected}
			onToggleSelect={context.bulkSelection.toggle}
			onSelectAll={context.bulkSelection.selectAll}
		/>
	{/if}
</ScrollArea>
