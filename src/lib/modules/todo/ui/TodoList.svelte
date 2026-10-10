<script lang="ts">
	import type { TodoFile } from "$lib/modules/todo/domain/todo";
	import * as Empty from "$lib/shared/ui/empty";
	import FileText from "@lucide/svelte/icons/file-text";
	import TodoItem from "./TodoItem.svelte";
	import { createTodoListVirtualization } from "./todo-list-virtualization.svelte";

	type TodoListProps = {
		todoFile: TodoFile;
		scrollElement: HTMLElement | null;
		items?: readonly TodoFile["items"][number][];
		disabled: boolean;
		onToggleComplete: (todo: TodoFile["items"][number]) => void;
		onDelete: (todo: TodoFile["items"][number]) => void;
	};

	let {
		todoFile,
		scrollElement,
		items = todoFile.items,
		disabled,
		onToggleComplete,
		onDelete,
	}: TodoListProps = $props();

	const virtualization = createTodoListVirtualization({
		get items() {
			return items;
		},
		get todoFilePath() {
			return todoFile.path;
		},
		get scrollElement() {
			return scrollElement;
		},
	});
</script>

{#if items.length > 0}
	<ul
		aria-label="Todo items"
		class="relative w-full"
		style:height={`${virtualization.totalSize}px`}
	>
		{#each virtualization.rows as { row, item } (row.key)}
			<li
				class="absolute top-0 left-0 w-full border-b border-border/50"
				style:height={`${row.size}px`}
				style:transform={`translateY(${row.start}px)`}
				aria-posinset={row.index + 1}
				aria-setsize={items.length}
				onfocusin={() => virtualization.focusItem(item)}
				onfocusout={virtualization.onFocusOut}
			>
				<TodoItem todo={item} {disabled} {onToggleComplete} {onDelete} />
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
