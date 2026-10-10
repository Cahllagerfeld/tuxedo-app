<script lang="ts">
	import type { TodoFile } from "$lib/modules/todo/domain/todo";
	import * as Empty from "$lib/shared/ui/empty";
	import { dragHandle } from "svelte-dnd-action";
	import GripVertical from "@lucide/svelte/icons/grip-vertical";
	import FileText from "@lucide/svelte/icons/file-text";
	import TodoItem from "./TodoItem.svelte";
	import { createTodoListView } from "./todo-list-view.svelte";

	type TodoListProps = {
		todoFile: TodoFile;
		scrollElement: HTMLElement | null;
		items?: readonly TodoFile["items"][number][];
		disabled: boolean;
		onToggleComplete: (todo: TodoFile["items"][number]) => void;
		onDelete: (todo: TodoFile["items"][number]) => void;
		onReorder?: (items: readonly TodoFile["items"][number][]) => void;
	};

	let {
		todoFile,
		scrollElement,
		items = todoFile.items,
		disabled,
		onToggleComplete,
		onDelete,
		onReorder,
	}: TodoListProps = $props();

	const list = createTodoListView({
		get items() {
			return items;
		},
		get todoFilePath() {
			return todoFile.path;
		},
		get scrollElement() {
			return scrollElement;
		},
		get disabled() {
			return disabled;
		},
		get onReorder() {
			return onReorder;
		},
	});
</script>

{#if items.length > 0}
	<ul
		aria-label="Todo items"
		class="relative w-full"
		use:list.dragZone
		style:height={`${list.totalSize}px`}
	>
		{#each list.rows as { todo, index, start, size, key } (key)}
			<li
				class="group absolute top-0 left-0 flex w-full items-center border-b border-border/50 transition-colors hover:bg-muted/50"
				style:height={`${size}px`}
				style:transform={`translateY(${start}px)`}
				aria-posinset={index + 1}
				aria-setsize={items.length}
				onfocusin={() => list.focusItem(todo)}
				onfocusout={list.onFocusOut}
			>
				{#if onReorder}
					<div
						role="button"
						tabindex="0"
						use:dragHandle
						data-reorder-handle
						aria-disabled={disabled || items.length < 2}
						aria-label={`Reorder ${todo.description}`}
						class="ml-3 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-disabled:opacity-40"
					>
						<GripVertical class="size-4" aria-hidden="true" />
					</div>
				{/if}
				<div class="min-w-0 flex-1">
					<TodoItem {todo} disabled={disabled || list.dragging} {onToggleComplete} {onDelete} />
				</div>
			</li>
		{/each}
	</ul>
{:else}
	<Empty.Root aria-label="No valid Todo items" class="min-h-full rounded-none border-0">
		<Empty.Media variant="icon"><FileText aria-hidden="true" /></Empty.Media>
		<Empty.Header>
			<Empty.Title>No valid Todo items</Empty.Title>
			<Empty.Description>This Todo file did not contain any parsed Todo items.</Empty.Description>
		</Empty.Header>
	</Empty.Root>
{/if}
