<script lang="ts">
	import type { TodoFile } from "$lib/modules/todo/domain/todo";
	import * as Empty from "$lib/shared/ui/empty";
	import FileText from "@lucide/svelte/icons/file-text";
	import TodoItem from "./TodoItem.svelte";
	import { createTodoListInteraction, type TodoItemAction } from "./todo-list-interaction.svelte";

	type TodoListProps = {
		todoFile: TodoFile;
		scrollElement: HTMLElement | null;
		items?: readonly TodoFile["items"][number][];
		disabled: boolean;
		workspaceKey?: string;
		showEmptyState?: boolean;
		onToggleComplete: TodoItemAction;
		onDelete: TodoItemAction;
	};

	let {
		todoFile,
		scrollElement,
		items = todoFile.items,
		disabled,
		onToggleComplete,
		onDelete,
		workspaceKey = todoFile.path,
		showEmptyState = true,
	}: TodoListProps = $props();
	let list = $state<HTMLUListElement | null>(null);
	const interaction = createTodoListInteraction({
		get items() {
			return items;
		},
		get todoFilePath() {
			return todoFile.path;
		},
		get scrollElement() {
			return scrollElement;
		},
		get list() {
			return list;
		},
		get workspaceKey() {
			return workspaceKey;
		},
		get disabled() {
			return disabled;
		},
		get onToggleComplete() {
			return onToggleComplete;
		},
		get onDelete() {
			return onDelete;
		},
	});
</script>

<!-- The list is a Tab entry and the empty-list focus fallback; rows use focus-only navigation. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<ul
	bind:this={list}
	{@attach interaction.navigation}
	tabindex="0"
	aria-label="Todo items"
	onkeydowncapture={interaction.preventRepeatedCheckboxActivation}
	onfocusin={interaction.onListFocus}
	class="relative w-full focus-visible:outline-2 focus-visible:outline-ring"
	style:height={`${items.length ? interaction.totalSize : 41}px`}
>
	{#each interaction.rows as { row, item } (row.key)}
		<li
			tabindex="-1"
			data-todo-line={item.line_number}
			class="absolute top-0 left-0 w-full border-b border-border/50 focus-visible:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
			style:height={`${row.size}px`}
			style:transform={`translateY(${row.start}px)`}
			aria-posinset={row.index + 1}
			aria-setsize={items.length}
			onfocusin={() => interaction.onRowFocus(item)}
			onfocusout={interaction.onRowFocusOut}
		>
			<TodoItem
				todo={item}
				{disabled}
				onToggleComplete={interaction.toggleCompletion}
				onDelete={interaction.deleteItem}
			/>
		</li>
	{/each}
</ul>
{#if items.length === 0 && showEmptyState}
	<Empty.Root aria-label="No valid Todo items" class="min-h-full rounded-none border-0">
		<Empty.Media variant="icon"><FileText aria-hidden="true" /></Empty.Media>
		<Empty.Header>
			<Empty.Title>No valid Todo items</Empty.Title>
			<Empty.Description>This Todo file did not contain any parsed Todo items.</Empty.Description>
		</Empty.Header>
	</Empty.Root>
{/if}
