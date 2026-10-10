<script lang="ts">
	import type { TodoFile } from "$lib/modules/todo/domain/todo";
	import * as Empty from "$lib/shared/ui/empty";
	import { flushSync } from "svelte";
	import type { ActionReturn } from "svelte/action";
	import {
		dragHandleZone,
		dragHandle,
		SOURCES,
		TRIGGERS,
		type DndEvent,
		type Options,
		type DndZoneAttributes,
	} from "svelte-dnd-action";
	import GripVertical from "@lucide/svelte/icons/grip-vertical";
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
	type DraggableTodo = { id: number | string; todo: TodoFile["items"][number] };
	let preview = $state.raw<DraggableTodo[] | null>(null);
	let original: readonly TodoFile["items"][number][] = [];
	let originalPath = "";
	let started = $state(false);
	let cancelled = false;
	const rows = $derived(
		preview
			? preview.map((item, index) => ({
					item,
					index,
					start: index * 41,
					size: 41,
					key: `${todoFile.path}:${item.id}`,
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
		dragDisabled: disabled || !onReorder || items.length < 2,
		dropFromOthersDisabled: true,
		type: "todo-items",
		zoneTabIndex: -1,
		dropTargetStyle: {},
		dropAnimationDisabled: true,
	});

	// Expand before the library handles the initiating event. Its item array must
	// match mounted rows, including offscreen destinations, throughout a drag.
	function virtualDragZone(
		node: HTMLElement,
		options: Options<DraggableTodo>
	): ActionReturn<Options<DraggableTodo>, DndZoneAttributes<DraggableTodo>> {
		function prepare(event: Event) {
			if (
				preview ||
				disabled ||
				!onReorder ||
				items.length < 2 ||
				!(event.target instanceof Element) ||
				!event.target.closest("[data-reorder-handle]")
			)
				return;
			if (event instanceof KeyboardEvent && ![" ", "Enter"].includes(event.key)) return;
			original = items;
			originalPath = todoFile.path;
			started = false;
			cancelled = false;
			flushSync(() => {
				preview = items.map((todo) => ({ id: todo.line_number, todo }));
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
		const zone = dragHandleZone(node, options);
		return {
			update: zone.update,
			destroy() {
				node.removeEventListener("mousedown", prepare, true);
				node.removeEventListener("touchstart", prepare, true);
				node.removeEventListener("keydown", prepare, true);
				window.removeEventListener("keydown", cancelOnEscape, true);
				window.removeEventListener("mouseup", release);
				window.removeEventListener("touchend", release);
				zone.destroy?.();
			},
		};
	}
	function finish(next: DraggableTodo[], id: string) {
		const valid = !cancelled && !disabled && items === original && todoFile.path === originalPath;
		const reordered = next.map((item) => item.todo);
		const focused = reordered.find((item) => String(item.line_number) === String(id));
		if (focused) virtualization.focusItem(focused);
		preview = null;
		started = false;
		if (valid && reordered.some((item, index) => item !== original[index])) onReorder?.(reordered);
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
</script>

{#if items.length > 0}
	<ul
		aria-label="Todo items"
		class="relative w-full"
		use:virtualDragZone={zoneOptions}
		onconsider={consider}
		onfinalize={finalize}
		style:height={`${preview ? preview.length * 41 : virtualization.totalSize}px`}
	>
		{#each rows as { item, index, start, size, key } (key)}
			<li
				class="group absolute top-0 left-0 flex w-full items-center border-b border-border/50 transition-colors hover:bg-muted/50"
				style:height={`${size}px`}
				style:transform={`translateY(${start}px)`}
				aria-posinset={index + 1}
				aria-setsize={items.length}
				onfocusin={() => virtualization.focusItem(item.todo)}
				onfocusout={virtualization.onFocusOut}
			>
				{#if onReorder}
					<div
						role="button"
						tabindex="0"
						use:dragHandle
						data-reorder-handle
						aria-disabled={disabled || items.length < 2}
						aria-label={`Reorder ${item.todo.description}`}
						class="ml-3 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-disabled:opacity-40"
					>
						<GripVertical class="size-4" aria-hidden="true" />
					</div>
				{/if}
				<div class="min-w-0 flex-1">
					<TodoItem todo={item.todo} disabled={disabled || started} {onToggleComplete} {onDelete} />
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
