<script lang="ts">
	import type { TodoFile } from "$lib/modules/todo/domain/todo";
	import * as Empty from "$lib/shared/ui/empty";
	import FileText from "@lucide/svelte/icons/file-text";
	import TodoItem from "./TodoItem.svelte";
	import { createVirtualizer, defaultRangeExtractor } from "@tanstack/svelte-virtual";
	import { get } from "svelte/store";

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

	let focusedLine = $state<number | null>(null);
	const todoPath = $derived(todoFile.path);
	// Focus changes must not invalidate TanStack's full-list measurement cache.
	const getItemKey = $derived.by(() => {
		const currentItems = items;
		const path = todoPath;
		return (index: number) => `${path}:${currentItems[index].line_number}`;
	});
	const virtualizer = createVirtualizer<HTMLElement, HTMLLIElement>({
		count: 0,
		getScrollElement: () => null,
		// TodoItem is h-10 (40px), plus the row's 1px separator.
		estimateSize: () => 41,
		overscan: 5,
	});
	// Capture each item with its row so children never read stale indexes during filtering.
	const virtualRows = $derived(
		$virtualizer.getVirtualItems().flatMap((row) => {
			const item = items[row.index];
			return item ? [{ row, item }] : [];
		})
	);

	// A different Todo file starts at the top of the shared viewport.
	$effect(() => {
		todoPath;
		if (scrollElement) get(virtualizer).scrollToOffset(0);
	});

	// Synchronize the external virtualizer with confirmed/filtered items and the viewport.
	$effect(() => {
		const currentItems = items;
		const viewport = scrollElement;
		const focusedIndex = currentItems.findIndex((item) => item.line_number === focusedLine);
		const instance = get(virtualizer);
		instance.setOptions({
			count: currentItems.length,
			getScrollElement: () => viewport,
			getItemKey,
			rangeExtractor: (range) => {
				const indexes = new Set(defaultRangeExtractor(range));
				// Keep focus mounted, including adjacent rows for Tab/Shift+Tab navigation.
				if (focusedIndex >= 0) {
					for (
						let index = Math.max(0, focusedIndex - 1);
						index <= Math.min(range.count - 1, focusedIndex + 1);
						index++
					) {
						indexes.add(index);
					}
				}
				return [...indexes].sort((a, b) => a - b);
			},
		});
		if (
			viewport &&
			viewport.scrollTop > Math.max(0, instance.getTotalSize() - viewport.clientHeight)
		) {
			instance.scrollToOffset(Math.max(0, instance.getTotalSize() - viewport.clientHeight));
		}
	});
</script>

{#if items.length > 0}
	<ul
		aria-label="Todo items"
		class="relative w-full"
		style:height={`${$virtualizer.getTotalSize()}px`}
	>
		{#each virtualRows as { row, item } (row.key)}
			<li
				class="absolute top-0 left-0 w-full border-b border-border/50"
				style:height={`${row.size}px`}
				style:transform={`translateY(${row.start}px)`}
				aria-posinset={row.index + 1}
				aria-setsize={items.length}
				onfocusin={() => (focusedLine = item.line_number)}
				onfocusout={(event) => {
					if (
						!(event.relatedTarget instanceof Node) ||
						!event.currentTarget.parentElement?.contains(event.relatedTarget)
					)
						focusedLine = null;
				}}
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
