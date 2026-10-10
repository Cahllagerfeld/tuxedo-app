<script lang="ts">
	import type { TodoFile } from "$lib/modules/todo/domain/todo";
	import * as Empty from "$lib/shared/ui/empty";
	import FileText from "@lucide/svelte/icons/file-text";
	import TodoItem from "./TodoItem.svelte";

	type TodoListProps = {
		todoFile: TodoFile;
		items?: readonly TodoFile["items"][number][];
		disabled: boolean;
		onToggleComplete: (todo: TodoFile["items"][number]) => void;
		onDelete: (todo: TodoFile["items"][number]) => void;
	};

	let {
		todoFile,
		items = todoFile.items,
		disabled,
		onToggleComplete,
		onDelete,
	}: TodoListProps = $props();
</script>

{#if items.length > 0}
	<ul aria-label="Todo items" class="w-full divide-y divide-border/50">
		{#each items as item (item.line_number)}
			<li>
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
