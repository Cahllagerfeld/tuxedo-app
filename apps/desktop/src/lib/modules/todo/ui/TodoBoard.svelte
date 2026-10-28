<script lang="ts">
	import { onDestroy, tick } from "svelte";
	import type { TodoItem } from "../domain/todo";
	import TodoBoardCard from "./TodoBoardCard.svelte";

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

	export async function focusTodo(todo: TodoItem) {
		await tick();
		if (destroyed) return;
		const found = items.find(
			(item) => item.line_number === todo.line_number && item.raw === todo.raw
		);
		(control(found?.line_number ?? -1) ?? board)?.focus();
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

<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll empty columns.) -->
<div
	bind:this={board}
	role="region"
	aria-label="Kanban board"
	tabindex="0"
	class="flex h-full min-h-0 min-w-0 gap-3 overflow-x-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
>
	{#each columns as column (column.name)}
		<section
			aria-label={column.name}
			class="flex h-full min-h-0 w-72 shrink-0 flex-col overflow-hidden rounded-lg border bg-muted/30"
		>
			<header class="flex shrink-0 items-center justify-between border-b px-3 py-3">
				<h2 class="text-sm font-semibold">{column.name}</h2>
				<span aria-hidden="true" class="text-xs text-muted-foreground">{column.items.length}</span>
			</header>
			<div class="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
				{#each column.items as todo (todo.line_number)}
					<TodoBoardCard {todo} {today} {disabled} {selectedTodo} {onOpen} {onToggleComplete} />
				{/each}
			</div>
		</section>
	{/each}
</div>
