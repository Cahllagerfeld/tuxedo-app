import { createVirtualizer, defaultRangeExtractor } from "@tanstack/svelte-virtual";
import { fromStore, get } from "svelte/store";
import type { TodoItem } from "../domain/todo";

type TodoListVirtualizationInputs = Readonly<{
	items: readonly TodoItem[];
	todoFilePath: string;
	scrollElement: HTMLElement | null;
}>;

// Create during Svelte initialization; input getters keep props reactive.
export function createTodoListVirtualization(inputs: TodoListVirtualizationInputs) {
	let focusedLine = $state<number | null>(null);
	const todoPath = $derived(inputs.todoFilePath);
	// Focus changes must not invalidate TanStack's full-list measurement cache.
	const getItemKey = $derived.by(() => {
		const currentItems = inputs.items;
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
	const instance = fromStore(virtualizer);
	// Capture each item with its row so children never read stale indexes during filtering.
	const rows = $derived(
		instance.current.getVirtualItems().flatMap((row) => {
			const item = inputs.items[row.index];
			return item ? [{ row, item }] : [];
		})
	);

	// A different Todo file starts at the top of the shared viewport.
	$effect(() => {
		todoPath;
		if (inputs.scrollElement) get(virtualizer).scrollToOffset(0);
	});

	// Synchronize the external virtualizer with confirmed/filtered items and the viewport.
	$effect(() => {
		const currentItems = inputs.items;
		const viewport = inputs.scrollElement;
		const focusedIndex = currentItems.findIndex((item) => item.line_number === focusedLine);
		const currentVirtualizer = get(virtualizer);
		currentVirtualizer.setOptions({
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
			viewport.scrollTop > Math.max(0, currentVirtualizer.getTotalSize() - viewport.clientHeight)
		) {
			currentVirtualizer.scrollToOffset(
				Math.max(0, currentVirtualizer.getTotalSize() - viewport.clientHeight)
			);
		}
	});

	return {
		get rows() {
			return rows;
		},
		get totalSize() {
			return instance.current.getTotalSize();
		},
		focusItem(item: TodoItem) {
			focusedLine = item.line_number;
		},
		onFocusOut(event: FocusEvent) {
			if (
				!(event.currentTarget instanceof HTMLElement) ||
				!(event.relatedTarget instanceof Node) ||
				!event.currentTarget.parentElement?.contains(event.relatedTarget)
			) {
				focusedLine = null;
			}
		},
	};
}
