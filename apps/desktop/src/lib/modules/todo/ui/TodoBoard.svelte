<script lang="ts">
	import { onDestroy, tick } from "svelte";
	import { boardAssignment, type BoardColumn } from "@tuxedo/contracts/board";
	import { SOURCES, TRIGGERS, type DndEvent } from "svelte-dnd-action";
	import type { TodoItem } from "../domain/todo";
	import { ScrollArea } from "#lib/shared/ui/scroll-area/index.js";
	import TodoBoardColumn, { type BoardDragItem } from "./TodoBoardColumn.svelte";

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
		onMove?: (todo: TodoItem, column: BoardColumn, trigger?: HTMLElement | null) => void;
	} = $props();

	const columns = $derived.by(() => {
		const grouped: Record<BoardColumn | "done", TodoItem[]> = {
			unassigned: [],
			"to-do": [],
			"in-progress": [],
			done: [],
		};
		for (const todo of items)
			grouped[todo.completed ? "done" : boardAssignment(todo.metadata.board).column].push(todo);
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
	let preview = $state.raw<Record<BoardColumn, BoardDragItem[]> | null>(null);
	let drag = $state.raw<{
		todo: TodoItem;
		items: readonly TodoItem[];
		order: Map<number, number>;
		from: BoardColumn;
		source: SOURCES;
		height: number;
	} | null>(null);
	let cancelled = false;
	let keyboardDropRequested = false;
	let announcement = $state("");
	const instructionsId = $props.id();
	const pending = new Set<() => void>();
	onDestroy(() => {
		destroyed = true;
		for (const stop of pending) stop();
	});

	function handleDragKeydown(event: KeyboardEvent) {
		if (!drag) return;
		if (event.key === "Escape") {
			cancelled = true;
			event.preventDefault();
		} else if (
			drag.source === SOURCES.KEYBOARD &&
			(event.key === " " || event.key === "Enter") &&
			event.target instanceof HTMLElement &&
			event.target.matches("[data-board-drag-item]") &&
			board?.contains(event.target)
		) {
			keyboardDropRequested = true;
		} else if (drag.source === SOURCES.KEYBOARD && event.key.startsWith("Arrow")) {
			// Board ordering is independent of List ordering and is added separately.
			event.preventDefault();
			event.stopPropagation();
		}
	}
	function updatePreview(column: BoardColumn, next: BoardDragItem[]) {
		if (!preview || !drag) return;
		const { order } = drag;
		preview = {
			...preview,
			[column]: [...next].sort(
				(a, b) => order.get(a.todo.line_number)! - order.get(b.todo.line_number)!
			),
		};
	}
	function finish(column: BoardColumn, event: CustomEvent<DndEvent<BoardDragItem>>) {
		if (!drag) return;
		const { todo, items: original, from, source } = drag;
		const trigger =
			source === SOURCES.KEYBOARD && event.currentTarget instanceof HTMLElement
				? event.currentTarget
						.querySelector<HTMLElement>(`[data-board-line="${todo.line_number}"]`)
						?.closest("li")
				: undefined;
		const valid =
			!cancelled &&
			!disabled &&
			items === original &&
			(source !== SOURCES.KEYBOARD || keyboardDropRequested);
		const changed = from !== column || boardAssignment(todo.metadata.board).invalid;
		preview = null;
		drag = null;
		announcement =
			valid && changed
				? `Moving ${todo.description} to ${columns.find((value) => value.id === column)?.name}.`
				: "Move cancelled.";
		if (valid && changed) onMove?.(todo, column, trigger);
	}
	function consider(column: BoardColumn, event: CustomEvent<DndEvent<BoardDragItem>>) {
		const { info, items: next } = event.detail;
		if (info.trigger === TRIGGERS.DRAG_STARTED) {
			const todo = items.find((item) => String(item.line_number) === String(info.id));
			if (!todo || disabled || !onMove) return;
			const element =
				event.currentTarget instanceof HTMLElement
					? event.currentTarget.querySelector<HTMLElement>(
							`[data-board-line="${todo.line_number}"]`
						)
					: null;
			drag = {
				todo,
				items,
				order: new Map(items.map((item, index) => [item.line_number, index])),
				from: column,
				source: info.source,
				height: element?.getBoundingClientRect().height ?? 88,
			};
			cancelled = false;
			keyboardDropRequested = false;
			const mounted = new Map(next.map((item) => [item.todo.line_number, item]));
			preview = {
				unassigned: [],
				"to-do": [],
				"in-progress": [],
			};
			for (const group of columns)
				if (group.id)
					preview[group.id] = group.items.map((item) => ({ id: item.line_number, todo: item }));
			preview = {
				...preview,
				[column]: preview[column].map((item) => mounted.get(item.todo.line_number) ?? item),
			};
			if (info.source === SOURCES.KEYBOARD)
				announcement = `Picked up ${todo.description}. Tab to another column, then press Space to drop. Press Escape to cancel.`;
		} else if (info.trigger === TRIGGERS.DRAG_STOPPED) {
			finish(column, event);
		} else updatePreview(column, next);
	}
	function finalize(column: BoardColumn, event: CustomEvent<DndEvent<BoardDragItem>>) {
		if (!drag) return;
		updatePreview(column, event.detail.items);
		if (event.detail.info.source === SOURCES.KEYBOARD) {
			if (event.detail.info.trigger === TRIGGERS.DROPPED_INTO_ZONE)
				announcement = `${columns.find((value) => value.id === column)?.name} selected for ${drag.todo.description}. Press Space to drop or Escape to cancel.`;
		} else {
			if (event.detail.info.trigger === TRIGGERS.DROPPED_OUTSIDE_OF_ANY) cancelled = true;
			finish(column, event);
		}
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
		const completion =
			origin instanceof HTMLElement && origin.hasAttribute("data-board-completion");
		let cancelled = false;
		const moved = (event: FocusEvent) => {
			if (
				event.target !== origin &&
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

<svelte:window onkeydowncapture={handleDragKeydown} />

<p id={instructionsId} class="sr-only">
	Press Space to pick up this card. Tab to another column and press Space to drop, or Escape to
	cancel.
</p>
<p class="sr-only" role="status">{announcement}</p>

<div class="relative h-full min-w-0">
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
					items={column.items}
					preview={column.id ? (preview?.[column.id] ?? null) : null}
					dragging={drag !== null}
					ghostHeight={drag?.height ?? 88}
					{instructionsId}
					{today}
					{disabled}
					{selectedTodo}
					{onOpen}
					{onToggleComplete}
					canMove={!!onMove}
					onConsider={consider}
					onFinalize={finalize}
				/>
			{/each}
		</div>
	</ScrollArea>
	{#if drag?.source === SOURCES.KEYBOARD}
		<div
			aria-hidden="true"
			class="pointer-events-none absolute right-4 bottom-4 left-4 z-20 mx-auto w-fit rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
		>
			Moving {drag.todo.description} · Tab to a column · Space to drop · Escape to cancel
		</div>
	{/if}
</div>
