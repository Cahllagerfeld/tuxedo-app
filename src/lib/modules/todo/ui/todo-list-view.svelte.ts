import { SOURCES, TRIGGERS, type DndEvent } from "svelte-dnd-action";
import type { TodoItem } from "../domain/todo";
import {
	createTodoListVirtualization,
	TODO_LIST_ROW_HEIGHT,
} from "./todo-list-virtualization.svelte";

type TodoListViewInputs = Readonly<{
	items: readonly TodoItem[];
	todoFilePath: string;
	scrollElement: HTMLElement | null;
	disabled: boolean;
	onReorder?: (items: readonly TodoItem[]) => void;
}>;

// Create during Svelte initialization with reactive input getters. Owns the
// temporary drag preview; confirmed Todo items continue to belong to the session.
export function createTodoListView(inputs: TodoListViewInputs) {
	const virtualization = createTodoListVirtualization(inputs);
	type DraggableTodo = { id: number | string; todo: TodoItem };
	let preview = $state.raw<DraggableTodo[] | null>(null);
	let original: readonly TodoItem[] = [];
	let originalPath = "";
	let cancelled = false;
	const rows = $derived(
		preview
			? preview.map((item, index) => ({
					item,
					index,
					start: index * TODO_LIST_ROW_HEIGHT,
					size: TODO_LIST_ROW_HEIGHT,
					key: `${inputs.todoFilePath}:${item.id}`,
				}))
			: virtualization.rows.map(({ row, item }) => ({
					item: { id: item.line_number, todo: item },
					index: row.index,
					start: row.start,
					size: row.size,
					key: row.key,
				}))
	);
	const zoneOptions = $derived({
		items: rows.map((row) => row.item),
		dragDisabled: inputs.disabled || !inputs.onReorder || inputs.items.length < 2,
		dropFromOthersDisabled: true,
		type: "todo-items",
		zoneTabIndex: -1,
		dropTargetStyle: {},
		dropAnimationDisabled: true,
	});

	// The library reports Escape as a keyboard drop, without its initiating key.
	// Capture it before the library's handler so Escape discards the preview,
	// including when focus has moved outside the list.
	function cancelOnEscape(event: KeyboardEvent) {
		if (preview && event.key === "Escape") cancelled = true;
	}

	function start(next: DraggableTodo[]) {
		original = inputs.items;
		originalPath = inputs.todoFilePath;
		cancelled = false;
		// The first event contains only mounted rows. Expand to all items once
		// dragging starts, retaining the library's pointer-drag placeholder.
		const mounted = new Map(next.map((item) => [item.todo.line_number, item]));
		preview = original.map(
			(todo) => mounted.get(todo.line_number) ?? { id: todo.line_number, todo }
		);
	}
	function finish(next: DraggableTodo[], id: string) {
		const valid =
			!cancelled &&
			!inputs.disabled &&
			inputs.items === original &&
			inputs.todoFilePath === originalPath;
		const reordered = next.map((item) => item.todo);
		const focused = reordered.find((item) => String(item.line_number) === String(id));
		if (focused) virtualization.focusItem(focused);
		preview = null;
		if (valid && reordered.some((item, index) => item !== original[index]))
			inputs.onReorder?.(reordered);
	}
	function consider(event: CustomEvent<DndEvent<DraggableTodo>>) {
		if (event.detail.info.trigger === TRIGGERS.DRAG_STARTED) {
			start(event.detail.items);
		} else if (event.detail.info.trigger === TRIGGERS.DRAG_STOPPED) {
			finish(event.detail.items, event.detail.info.id);
		} else {
			preview = event.detail.items;
		}
	}
	function finalize(event: CustomEvent<DndEvent<DraggableTodo>>) {
		if (event.detail.info.source === SOURCES.KEYBOARD) preview = event.detail.items;
		else {
			if (event.detail.info.trigger === TRIGGERS.DROPPED_OUTSIDE_OF_ANY) cancelled = true;
			finish(event.detail.items, event.detail.info.id);
		}
	}

	return {
		get rows() {
			return rows.map(({ item, ...row }) => ({ ...row, todo: item.todo }));
		},
		get totalSize() {
			return preview ? preview.length * TODO_LIST_ROW_HEIGHT : virtualization.totalSize;
		},
		get dragging() {
			return preview !== null;
		},
		get zoneOptions() {
			return zoneOptions;
		},
		consider,
		finalize,
		cancelOnEscape,
		focusItem: virtualization.focusItem,
		onFocusOut: virtualization.onFocusOut,
	};
}
