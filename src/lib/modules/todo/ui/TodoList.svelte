<script lang="ts">
	import { createTodoListFocus } from "./todo-list-focus.svelte";
	import { getShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import type { TodoFile } from "$lib/modules/todo/domain/todo";
	import { Button } from "$lib/shared/ui/button";
	import * as Empty from "$lib/shared/ui/empty";
	import { dragHandle, dragHandleZone } from "svelte-dnd-action";
	import GripVertical from "@lucide/svelte/icons/grip-vertical";
	import FileText from "@lucide/svelte/icons/file-text";
	import TodoItem from "./TodoItem.svelte";
	import { createTodoListView } from "./todo-list-view.svelte";
	import { localToday } from "../domain/todo-due";

	type TodoListProps = {
		todoFile: TodoFile;
		today?: string;
		showEmpty?: boolean;
		workspaceId?: string;
		fallback?: HTMLElement | null;
		scrollElement: HTMLElement | null;
		items?: readonly TodoFile["items"][number][];
		disabled: boolean;
		onToggleComplete: (todo: TodoFile["items"][number]) => void;
		onDelete: (todo: TodoFile["items"][number], trigger?: HTMLButtonElement | null) => void;
		onEdit?: (todo: TodoFile["items"][number], trigger: HTMLButtonElement | null) => void;
		onReorder?: (items: readonly TodoFile["items"][number][]) => void;
		onSelect?: (todo: TodoFile["items"][number]) => void;
		onNavigate?: (todo: TodoFile["items"][number]) => void;
		selectedTodo?: TodoFile["items"][number] | null;
	};

	let {
		todoFile,
		today = localToday(),
		showEmpty = true,
		workspaceId = todoFile.path,
		fallback = null,
		scrollElement,
		items = todoFile.items,
		disabled,
		onToggleComplete,
		onDelete,
		onEdit,
		onReorder,
		onSelect,
		onNavigate,
		selectedTodo = null,
	}: TodoListProps = $props();

	const list = createTodoListView({
		get items() {
			return items;
		},
		get todoFilePath() {
			return todoFile.path;
		},
		get scrollElement() {
			return scrollElement;
		},
		get disabled() {
			return disabled;
		},
		get onReorder() {
			return onReorder;
		},
	});

	let root = $state<HTMLUListElement | null>(null);
	const scope = getShortcutScope();
	const focus = createTodoListFocus({
		get items() {
			return items;
		},
		get todoFile() {
			return todoFile;
		},
		get workspaceId() {
			return workspaceId;
		},
		get root() {
			return root;
		},
		get fallback() {
			return items.length > 0 ? root : (fallback ?? root);
		},
		get disabled() {
			return disabled;
		},
		get dragging() {
			return list.dragging;
		},
		scope,
		reveal: list.reveal,
		onToggle: (todo) => onToggleComplete(todo),
		onEdit: (todo, trigger) => onEdit?.(todo, trigger),
		onSelect: (todo) => onSelect?.(todo),
	});
	export const captureFocus = focus.capture;
	export const focusTodo = focus.focusTodo;
</script>

<svelte:window onkeydowncapture={list.cancelOnEscape} />

{#if items.length > 0}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<ul
		bind:this={root}
		tabindex={focus.index < 0 ? 0 : -1}
		onkeydown={(event) => focus.keydown(event)}
		aria-label="Todo items"
		class="relative w-full"
		use:dragHandleZone={{ ...list.zoneOptions, zoneTabIndex: focus.index < 0 ? 0 : -1 }}
		onconsider={list.consider}
		onfinalize={list.finalize}
		style:height={`${list.totalSize}px`}
	>
		{#each list.rows as { todo, index, start, size, key } (key)}
			<li
				class="group absolute left-0 flex w-full items-center border-b border-border/50 transition-colors hover:bg-muted/50 has-[[data-row-navigation]:focus-visible]:bg-accent"
				class:bg-accent={selectedTodo?.line_number === todo.line_number &&
					selectedTodo?.raw === todo.raw}
				style:height={`${size}px`}
				style:top={`${start}px`}
				aria-posinset={index + 1}
				aria-setsize={items.length}
				onfocusin={(event) => {
					list.focusItem(todo);
					focus.remember(todo);
					if (
						event.target instanceof HTMLElement &&
						event.target.hasAttribute("data-row-navigation")
					)
						onNavigate?.(todo);
				}}
				onfocusout={list.onFocusOut}
			>
				<Button
					variant="ghost"
					type="button"
					data-row-navigation={index}
					aria-label={`Navigate ${todo.description}`}
					aria-expanded={onSelect
						? selectedTodo?.line_number === todo.line_number && selectedTodo?.raw === todo.raw
						: undefined}
					tabindex={focus.index === index ? 0 : -1}
					class="absolute inset-0 h-full w-full rounded-none p-0 focus-visible:border-transparent focus-visible:ring-0 focus-visible:inset-ring-1 focus-visible:inset-ring-ring focus-visible:outline-none"
					onkeydown={(event) => focus.keydown(event, todo)}
					onclick={() => {
						if (!disabled && !list.dragging) onSelect?.(todo);
					}}
				></Button>
				{#if onReorder}
					<div
						role="button"
						tabindex="0"
						use:dragHandle
						aria-disabled={disabled || items.length < 2}
						aria-label={`Reorder ${todo.description}`}
						class="relative z-10 ml-3 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-disabled:opacity-40"
					>
						<GripVertical class="size-4" aria-hidden="true" />
					</div>
				{/if}
				<div class="pointer-events-none relative z-10 min-w-0 flex-1">
					<TodoItem
						{todo}
						{today}
						disabled={disabled || list.dragging}
						{onToggleComplete}
						{onDelete}
						{onEdit}
					/>
				</div>
			</li>
		{/each}
	</ul>
{:else if showEmpty}
	<Empty.Root aria-label="No valid Todo items" class="min-h-full rounded-none border-0">
		<Empty.Media variant="icon"><FileText aria-hidden="true" /></Empty.Media>
		<Empty.Header>
			<Empty.Title>No valid Todo items</Empty.Title>
			<Empty.Description>This Todo file did not contain any parsed Todo items.</Empty.Description>
		</Empty.Header>
	</Empty.Root>
{/if}
