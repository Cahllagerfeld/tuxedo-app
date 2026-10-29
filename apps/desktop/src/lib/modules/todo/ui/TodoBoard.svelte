<script lang="ts">
	import { onDestroy, tick } from "svelte";
	import { boardAssignment, type BoardColumn } from "@tuxedo/contracts/board";
	import type { TodoItem } from "../domain/todo";
	import { ScrollArea } from "#lib/shared/ui/scroll-area/index.js";
	import TodoBoardColumn from "./TodoBoardColumn.svelte";

	let {
		items,
		today,
		disabled,
		selectedTodo = null,
		onOpen,
		onToggleComplete,
		onMove,
	}: {
		items: readonly TodoItem[];
		today: string;
		disabled: boolean;
		selectedTodo?: TodoItem | null;
		onOpen: (todo: TodoItem, trigger: HTMLElement) => void;
		onToggleComplete: (todo: TodoItem) => void;
		onMove?: (todo: TodoItem, column: BoardColumn, trigger?: HTMLButtonElement | null) => void;
	} = $props();

	const columns = $derived.by(() => {
		const grouped: Record<BoardColumn | "done", TodoItem[]> = {
			unassigned: [],
			"to-do": [],
			"in-progress": [],
			done: [],
		};
		for (const todo of items)
			grouped[todo.completed ? "done" : boardAssignment(todo.raw).column].push(todo);
		return [
			{ name: "Unassigned", id: "unassigned" as const, items: grouped.unassigned },
			{ name: "To do", id: "to-do" as const, items: grouped["to-do"] },
			{ name: "In progress", id: "in-progress" as const, items: grouped["in-progress"] },
			{ name: "Done", id: null, items: grouped.done },
		];
	});
	let board = $state<HTMLElement | null>(null);
	let columnViews = $state<Record<string, ReturnType<typeof TodoBoardColumn>>>({});
	let destroyed = false;
	let dragged: { todo: TodoItem; items: readonly TodoItem[] } | null = null;
	let dropTarget = $state<BoardColumn | null>(null);
	let pointer = { x: 0, y: 0 };
	let frame = 0;
	const pending = new Set<() => void>();
	onDestroy(() => {
		destroyed = true;
		cancelAnimationFrame(frame);
		for (const stop of pending) stop();
	});

	function stopDrag() {
		dragged = null;
		dropTarget = null;
		cancelAnimationFrame(frame);
		frame = 0;
	}
	function startDrag(todo: TodoItem, event: DragEvent) {
		if (disabled || !onMove || todo.completed) return event.preventDefault();
		dragged = { todo, items };
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData("application/x-tuxedo-todo", String(todo.line_number));
		}
	}
	function scrollAtEdge(position: number, start: number, end: number) {
		if (position < start || position > end) return 0;
		return position < start + 40 ? -12 : position > end - 40 ? 12 : 0;
	}
	function scrollDuringDrag() {
		if (!dragged || !board) return;
		const rect = board.getBoundingClientRect();
		if (pointer.y >= rect.top && pointer.y <= rect.bottom)
			board.scrollLeft += scrollAtEdge(pointer.x, rect.left, rect.right);
		const section = document.elementFromPoint(pointer.x, pointer.y)?.closest("[data-board-column]");
		const viewport = section?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
		if (viewport) {
			const bounds = viewport.getBoundingClientRect();
			viewport.scrollTop += scrollAtEdge(pointer.y, bounds.top, bounds.bottom);
		}
		frame = requestAnimationFrame(scrollDuringDrag);
	}
	function trackDrag(event: DragEvent) {
		if (!dragged) return;
		pointer = { x: event.clientX, y: event.clientY };
		if (!(event.target instanceof Element) || !event.target.closest("[data-board-column]"))
			dropTarget = null;
		if (!frame) frame = requestAnimationFrame(scrollDuringDrag);
	}
	function drop(column: BoardColumn, event: DragEvent) {
		if (!dragged || disabled) return;
		event.preventDefault();
		const { todo, items: original } = dragged;
		const assignment = boardAssignment(todo.raw);
		stopDrag();
		if (items === original && (assignment.column !== column || assignment.invalid))
			onMove?.(todo, column);
	}

	function control(line: number, completion = false) {
		return board?.querySelector<HTMLElement>(
			`[data-board-line="${line}"] [data-board-${completion ? "completion" : "open"}]`
		);
	}
	async function reveal(line: number) {
		const column = columns.find((column) => column.items.some((item) => item.line_number === line));
		if (column) await columnViews[column.name]?.reveal(line);
	}

	export async function focusTodo(todo: TodoItem) {
		await tick();
		if (destroyed) return;
		const found = items.find(
			(item) => item.line_number === todo.line_number && item.raw === todo.raw
		);
		if (found) await reveal(found.line_number);
		if (destroyed) return;
		const current = items.some(
			(item) => item.line_number === todo.line_number && item.raw === todo.raw
		);
		(control(current ? todo.line_number : -1) ?? board)?.focus();
	}

	export function captureFocus(todo: TodoItem, editing = false, trigger?: HTMLElement | null) {
		const origin = trigger ?? document.activeElement;
		const owned = !!board?.contains(origin);
		const menu = trigger?.hasAttribute("data-dropdown-menu-trigger")
			? document.activeElement?.closest('[data-slot="dropdown-menu-content"]')
			: null;
		const completion =
			origin instanceof HTMLElement && origin.hasAttribute("data-board-completion");
		let cancelled = false;
		const moved = (event: FocusEvent) => {
			if (
				event.target !== origin &&
				!(event.target instanceof Node && menu?.contains(event.target)) &&
				!(editing && event.target instanceof HTMLElement && event.target.closest('[role="dialog"]'))
			)
				cancelled = true;
		};
		if (owned) document.addEventListener("focusin", moved);
		const stop = () => {
			cancelled = true;
			document.removeEventListener("focusin", moved);
			pending.delete(stop);
		};
		pending.add(stop);
		return {
			cancel: stop,
			async restore(uncertain = false, deleted = false) {
				await tick();
				if (!destroyed && owned && !cancelled && !uncertain && !deleted) {
					await reveal(todo.line_number);
				}
				document.removeEventListener("focusin", moved);
				pending.delete(stop);
				if (destroyed || !owned || cancelled) return;
				const found =
					!uncertain && !deleted && items.some((item) => item.line_number === todo.line_number);
				(control(found ? todo.line_number : -1, completion) ?? board)?.focus();
			},
		};
	}
</script>

<svelte:window ondragover={trackDrag} />

<ScrollArea
	bind:viewportRef={board}
	viewportLabel="Kanban board"
	viewportTabIndex={0}
	orientation="horizontal"
	class="h-full w-full min-w-0 [&>[data-slot=scroll-area-viewport]>[data-scroll-area-content]]:h-full"
>
	<div class="flex h-full min-w-max gap-3 p-4">
		{#each columns as column (column.name)}
			<TodoBoardColumn
				bind:this={columnViews[column.name]}
				name={column.name}
				column={column.id}
				isDropTarget={column.id !== null && dropTarget === column.id}
				items={column.items}
				{today}
				{disabled}
				{selectedTodo}
				{onOpen}
				{onToggleComplete}
				{onMove}
				onDragStart={startDrag}
				onDragEnd={stopDrag}
				onDragOver={(event) => {
					if (dragged && !disabled) {
						event.preventDefault();
						dropTarget = column.id;
						if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
					}
				}}
				onDrop={drop}
			/>
		{/each}
	</div>
</ScrollArea>
