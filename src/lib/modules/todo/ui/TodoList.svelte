<script lang="ts">
	import type { TodoFile } from "$lib/modules/todo/domain/todo";
	import * as Empty from "$lib/shared/ui/empty";
	import FileText from "@lucide/svelte/icons/file-text";
	import TodoItem from "./TodoItem.svelte";

	type TodoListProps = {
		todoFile: TodoFile;
	};

	let { todoFile }: TodoListProps = $props();
</script>

{#if todoFile.items.length > 0}
	<ul aria-label="Todo items" class="-mx-4 w-full divide-y">
		{#each todoFile.items as item (item.line_number)}
			<li>
				<TodoItem todo={item} />
			</li>
		{/each}
	</ul>
{:else}
	<Empty.Root aria-label="No valid Todo items" class="min-h-full border-0 rounded-none">
		<Empty.Media variant="icon"><FileText aria-hidden="true" /></Empty.Media>
		<Empty.Header>
			<Empty.Title>No valid Todo items</Empty.Title>
			<Empty.Description>This Todo file did not contain any parsed Todo items.</Empty.Description>
		</Empty.Header>
	</Empty.Root>
{/if}
