<script lang="ts">
	import { createVirtualizer, defaultRangeExtractor } from "@tanstack/svelte-virtual";
	import { fromStore, get } from "svelte/store";
	import { tick } from "svelte";
	import { ScrollArea } from "#lib/shared/ui/scroll-area/index.js";
	import type { TodoItem } from "../domain/todo";
	import type { BoardColumn } from "@tuxedo/contracts/board";
	import TodoBoardCard from "./TodoBoardCard.svelte";

	let {
		name,
		column,
		isDropTarget,
		items,
		today,
		disabled,
		selectedTodo,
		onOpen,
		onToggleComplete,
		onMove,
		onDragStart,
		onDragEnd,
		onDragOver,
		onDrop,
	}: {
		name: string;
		column: BoardColumn | null;
		isDropTarget: boolean;
		items: readonly TodoItem[];
		today: string;
		disabled: boolean;
		selectedTodo: TodoItem | null;
		onOpen: (todo: TodoItem, trigger: HTMLElement) => void;
		onToggleComplete: (todo: TodoItem) => void;
		onMove?: (todo: TodoItem, column: BoardColumn, trigger?: HTMLButtonElement | null) => void;
		onDragStart: (todo: TodoItem, event: DragEvent) => void;
		onDragEnd: () => void;
		onDragOver: (event: DragEvent) => void;
		onDrop: (column: BoardColumn, event: DragEvent) => void;
	} = $props();

	let viewport = $state<HTMLElement | null>(null);
	let focusedLine = $state<number | null>(null);
	const getItemKey = $derived.by(() => {
		const currentItems = items;
		return (index: number) => currentItems[index].line_number;
	});
	const virtualizer = createVirtualizer<HTMLElement, HTMLLIElement>({
		count: 0,
		getScrollElement: () => null,
		estimateSize: () => 88,
		overscan: 3,
		gap: 8,
		paddingStart: 8,
		paddingEnd: 8,
		// Defer updates because resizing cards and scrollbars otherwise triggers observer loops.
		useAnimationFrameWithResizeObserver: true,
	});
	const instance = fromStore(virtualizer);
	const rows = $derived(
		instance.current.getVirtualItems().flatMap((row) => {
			const item = items[row.index];
			return item ? [{ row, item }] : [];
		})
	);

	// Keep the virtualizer in sync with the column's filtered items and viewport.
	$effect(() => {
		const currentItems = items;
		const currentViewport = viewport;
		const focusedIndex = currentItems.findIndex((item) => item.line_number === focusedLine);
		const current = get(virtualizer);
		current.setOptions({
			count: currentItems.length,
			getScrollElement: () => currentViewport,
			getItemKey,
			rangeExtractor: (range) => {
				const indexes = new Set(defaultRangeExtractor(range));
				// Keep the focused card and its neighbors mounted for Tab and Shift+Tab.
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
		if (currentViewport) {
			const maxOffset = Math.max(0, current.getTotalSize() - currentViewport.clientHeight);
			if (currentViewport.scrollTop > maxOffset) current.scrollToOffset(maxOffset);
		}
	});

	function measure(node: HTMLLIElement) {
		const current = get(virtualizer);
		current.measureElement(node);
		return {
			destroy: () => queueMicrotask(() => current.measureElement(null)),
		};
	}

	function clearFocus(event: FocusEvent) {
		if (
			!(event.currentTarget instanceof HTMLElement) ||
			!(event.relatedTarget instanceof Node) ||
			!event.currentTarget.parentElement?.contains(event.relatedTarget)
		) {
			focusedLine = null;
		}
	}

	export async function reveal(line: number) {
		const index = items.findIndex((item) => item.line_number === line);
		if (index < 0) return;
		focusedLine = line;
		get(virtualizer).scrollToIndex(index, { align: "auto" });
		await tick();
	}
</script>

<section
	aria-label={name}
	data-board-column={column ?? undefined}
	class:ring-2={isDropTarget}
	class:ring-primary={isDropTarget}
	ondragover={(event) => {
		if (column) onDragOver(event);
	}}
	ondrop={(event) => {
		if (column) onDrop(column, event);
	}}
	class="flex h-full min-h-0 w-72 shrink-0 flex-col overflow-hidden rounded-lg border bg-muted/30"
>
	<header class="flex shrink-0 items-center justify-between border-b px-3 py-3">
		<h2 class="text-sm font-semibold">{name}</h2>
		<span aria-hidden="true" class="text-xs text-muted-foreground">{items.length}</span>
	</header>
	<ScrollArea
		bind:viewportRef={viewport}
		class="min-h-0 flex-1"
		viewportLabel={`${name} Todo items`}
		viewportTabIndex={0}
	>
		<ul class="relative mx-2" style:height={`${instance.current.getTotalSize()}px`}>
			{#each rows as { row, item } (row.key)}
				<li
					use:measure
					data-index={row.index}
					aria-posinset={row.index + 1}
					aria-setsize={items.length}
					class="absolute top-0 right-0 left-0"
					style:transform={`translateY(${row.start}px)`}
					onfocusin={() => (focusedLine = item.line_number)}
					onfocusout={clearFocus}
				>
					<TodoBoardCard
						todo={item}
						{today}
						{disabled}
						{selectedTodo}
						{onOpen}
						{onToggleComplete}
						{onMove}
						onDragStart={(todo, event) => {
							focusedLine = todo.line_number;
							onDragStart(todo, event);
						}}
						{onDragEnd}
					/>
				</li>
			{/each}
		</ul>
	</ScrollArea>
</section>
