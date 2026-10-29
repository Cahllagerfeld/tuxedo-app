<script lang="ts" module>
	import type { TodoItem } from "../domain/todo";
	export type BoardDragItem = { id: string | number; todo: TodoItem; isDndShadowItem?: boolean };
</script>

<script lang="ts">
	import { createVirtualizer, defaultRangeExtractor } from "@tanstack/svelte-virtual";
	import { dndzone, type DndEvent } from "svelte-dnd-action";
	import { flip } from "svelte/animate";
	import { prefersReducedMotion } from "svelte/motion";
	import { fromStore, get } from "svelte/store";
	import { tick } from "svelte";
	import { ScrollArea } from "#lib/shared/ui/scroll-area/index.js";
	import type { BoardColumn } from "@tuxedo/contracts/board";
	import TodoBoardCard from "./TodoBoardCard.svelte";

	let {
		name,
		column,
		items,
		preview,
		dragging,
		ghostHeight,
		instructionsId,
		today,
		disabled,
		selectedTodo,
		onOpen,
		onToggleComplete,
		canMove,
		onConsider,
		onFinalize,
	}: {
		name: string;
		column: BoardColumn | null;
		items: readonly TodoItem[];
		preview: BoardDragItem[] | null;
		dragging: boolean;
		ghostHeight: number;
		instructionsId: string;
		today: string;
		disabled: boolean;
		selectedTodo: TodoItem | null;
		onOpen: (todo: TodoItem, trigger: HTMLElement) => void;
		onToggleComplete: (todo: TodoItem) => void;
		canMove: boolean;
		onConsider: (column: BoardColumn, event: CustomEvent<DndEvent<BoardDragItem>>) => void;
		onFinalize: (column: BoardColumn, event: CustomEvent<DndEvent<BoardDragItem>>) => void;
	} = $props();

	let viewport = $state<HTMLElement | null>(null);
	let focusedLine = $state<number | null>(null);
	const draggable = (todo: TodoItem): BoardDragItem => ({ id: todo.line_number, todo });
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
		preview
			? preview.map((item, index) => ({ item, index, start: 0, key: `preview:${item.id}` }))
			: instance.current.getVirtualItems().flatMap((row) => {
					const item = items[row.index];
					return item
						? [{ item: draggable(item), index: row.index, start: row.start, key: row.key }]
						: [];
				})
	);
	const zone = $derived({
		items: rows.map((row) => row.item),
		type: column ? "kanban-open" : "kanban-done",
		dragDisabled: disabled || !canMove || !column,
		dropFromOthersDisabled: !column,
		zoneTabIndex: -1,
		zoneItemTabIndex: column && canMove && !disabled ? 0 : -1,
		autoAriaDisabled: true,
		morphDisabled: true,
		dropAnimationDisabled: true,
		useCursorForDetection: true,
		dropTargetStyle: {},
		dropTargetClasses: ["bg-primary/5", "rounded-md", "ring-1", "ring-primary/30"],
		flipDurationMs: prefersReducedMotion.current ? 0 : 120,
	});

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

	function measure(node: HTMLLIElement, enabled: boolean) {
		const current = get(virtualizer);
		if (enabled) current.measureElement(node);
		return {
			update: (next: boolean) => {
				if (next) current.measureElement(node);
			},
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
	class="flex h-full min-h-0 w-72 shrink-0 flex-col overflow-hidden rounded-lg border bg-muted/30"
>
	<header class="flex shrink-0 items-center justify-between border-b px-3 py-3">
		<h2 class="text-sm font-semibold">{name}</h2>
		<span aria-hidden="true" class="text-xs text-muted-foreground"
			>{preview?.length ?? items.length}</span
		>
	</header>
	<ScrollArea
		bind:viewportRef={viewport}
		class="min-h-0 flex-1"
		viewportLabel={`${name} Todo items`}
		viewportTabIndex={dragging ? -1 : 0}
	>
		<ul
			aria-label={`${name} cards`}
			use:dndzone={zone}
			onconsider={(event) => {
				if (column) onConsider(column, event);
			}}
			onfinalize={(event) => {
				if (column) onFinalize(column, event);
			}}
			class={preview ? "relative mx-2 flex flex-col gap-2 py-2" : "relative mx-2"}
			style:height={preview ? undefined : `${instance.current.getTotalSize()}px`}
			style:min-height={`${instance.current.scrollRect?.height ?? 80}px`}
		>
			{#each rows as { item, index, start, key } (key)}
				<li
					use:measure={!preview}
					animate:flip={{ duration: preview && !prefersReducedMotion.current ? 120 : 0 }}
					data-board-drag-item
					data-index={index}
					data-board-placeholder={item.isDndShadowItem ? "" : undefined}
					aria-label={item.todo.description}
					aria-describedby={column && canMove ? instructionsId : undefined}
					aria-hidden={item.isDndShadowItem ? "true" : undefined}
					aria-posinset={index + 1}
					aria-setsize={preview?.length ?? items.length}
					class={preview
						? "rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
						: "absolute right-0 left-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"}
					style:top={preview ? undefined : `${start}px`}
					onfocusin={() => (focusedLine = item.todo.line_number)}
					onfocusout={clearFocus}
				>
					{#if item.isDndShadowItem}
						<div
							class="visible rounded-md border-2 border-dashed border-primary/50 bg-primary/5"
							style:height={`${ghostHeight}px`}
						></div>
					{:else}
						<TodoBoardCard
							todo={item.todo}
							{today}
							disabled={disabled || dragging}
							{selectedTodo}
							{onOpen}
							{onToggleComplete}
							movable={!!column && canMove}
						/>
					{/if}
				</li>
			{/each}
		</ul>
	</ScrollArea>
</section>
