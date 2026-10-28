<script lang="ts">
	import { onDestroy, tick } from "svelte";
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
	}: {
		items: readonly TodoItem[];
		today: string;
		disabled: boolean;
		selectedTodo?: TodoItem | null;
		onOpen: (todo: TodoItem, trigger: HTMLElement) => void;
		onToggleComplete: (todo: TodoItem) => void;
	} = $props();

	const columns = $derived([
		{ name: "Unassigned", items: items.filter((todo) => !todo.completed) },
		{ name: "To do", items: [] as readonly TodoItem[] },
		{ name: "In progress", items: [] as readonly TodoItem[] },
		{ name: "Done", items: items.filter((todo) => todo.completed) },
	]);
	let board = $state<HTMLElement | null>(null);
	let columnViews = $state<Record<string, ReturnType<typeof TodoBoardColumn>>>({});
	let destroyed = false;
	const pending = new Set<() => void>();
	onDestroy(() => {
		destroyed = true;
		for (const stop of pending) stop();
	});

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
				items={column.items}
				{today}
				{disabled}
				{selectedTodo}
				{onOpen}
				{onToggleComplete}
			/>
		{/each}
	</div>
</ScrollArea>
