import { flushSync } from "svelte";
import { dragHandleZone, SOURCES, TRIGGERS, type DndEvent } from "svelte-dnd-action";
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
	let started = $state(false);
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

	// Expand before the library handles the initiating event. Its item array must
	// match mounted rows, including offscreen destinations, throughout a drag.
	function dragZone(node: HTMLElement) {
		function prepare(event: Event) {
			if (
				preview ||
				inputs.disabled ||
				!inputs.onReorder ||
				inputs.items.length < 2 ||
				!(event.target instanceof Element) ||
				!event.target.closest("[data-reorder-handle]")
			)
				return;
			if (event instanceof KeyboardEvent && ![" ", "Enter"].includes(event.key)) return;
			original = inputs.items;
			originalPath = inputs.todoFilePath;
			started = false;
			cancelled = false;
			flushSync(() => {
				preview = inputs.items.map((todo) => ({ id: todo.line_number, todo }));
			});
		}
		function cancelOnEscape(event: KeyboardEvent) {
			if (started && event.key === "Escape") cancelled = true;
		}
		function release() {
			if (!started) preview = null;
		}
		node.addEventListener("mousedown", prepare, true);
		node.addEventListener("touchstart", prepare, true);
		node.addEventListener("keydown", prepare, true);
		window.addEventListener("keydown", cancelOnEscape, true);
		window.addEventListener("mouseup", release);
		window.addEventListener("touchend", release);
		const zone = dragHandleZone(node, zoneOptions);
		// The action owns synchronization with the external drag-and-drop library.
		$effect(() => {
			zone.update?.(zoneOptions);
		});
		function onConsider(event: Event) {
			if (event instanceof CustomEvent) consider(event);
		}
		function onFinalize(event: Event) {
			if (event instanceof CustomEvent) finalize(event);
		}
		node.addEventListener("consider", onConsider);
		node.addEventListener("finalize", onFinalize);
		return {
			destroy() {
				node.removeEventListener("mousedown", prepare, true);
				node.removeEventListener("touchstart", prepare, true);
				node.removeEventListener("keydown", prepare, true);
				window.removeEventListener("keydown", cancelOnEscape, true);
				window.removeEventListener("mouseup", release);
				window.removeEventListener("touchend", release);
				node.removeEventListener("consider", onConsider);
				node.removeEventListener("finalize", onFinalize);
				zone.destroy?.();
			},
		};
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
		started = false;
		if (valid && reordered.some((item, index) => item !== original[index]))
			inputs.onReorder?.(reordered);
	}
	function consider(event: CustomEvent<DndEvent<DraggableTodo>>) {
		if (event.detail.info.trigger === TRIGGERS.DRAG_STOPPED) {
			finish(event.detail.items, event.detail.info.id);
		} else {
			started = true;
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
			return started;
		},
		dragZone,
		focusItem: virtualization.focusItem,
		onFocusOut: virtualization.onFocusOut,
	};
}
