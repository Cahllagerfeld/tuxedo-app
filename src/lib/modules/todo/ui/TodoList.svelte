<script lang="ts">
	import type { TodoFile } from "$lib/modules/todo/domain/todo";
	import * as Empty from "$lib/shared/ui/empty";
	import FileText from "@lucide/svelte/icons/file-text";
	import TodoItem from "./TodoItem.svelte";
	import { createTodoListVirtualization } from "./todo-list-virtualization.svelte";
	import { tick } from "svelte";
	import { createHotkeysAttachment } from "@tanstack/svelte-hotkeys";
	import { shortcutSurfaceOpen } from "$lib/shared/keyboard";
	import { todoShortcuts } from "./todo-shortcuts";

	type TodoListProps = {
		todoFile: TodoFile;
		scrollElement: HTMLElement | null;
		items?: readonly TodoFile["items"][number][];
		disabled: boolean;
		workspaceKey?: string;
		showEmptyState?: boolean;
		onToggleComplete: (todo: TodoFile["items"][number]) => void | Promise<boolean | void>;
		onDelete: (todo: TodoFile["items"][number]) => void | Promise<boolean | void>;
	};

	let {
		todoFile,
		scrollElement,
		items = todoFile.items,
		disabled,
		onToggleComplete,
		onDelete,
		workspaceKey = todoFile.path,
		showEmptyState = true,
	}: TodoListProps = $props();
	let list = $state<HTMLUListElement | null>(null);
	let focusVersion = 0;
	let localOperation = false;
	let focusedRow = $state<number | null>(null);

	async function focusIndex(index: number) {
		const item = items[index];
		if (!item || !list) return;
		const version = focusVersion;
		const scope = workspaceKey;
		virtualization.focusItem(item);
		virtualization.scrollToItem(index);
		await tick();
		if (scope !== workspaceKey || version !== focusVersion) return;
		list.querySelector<HTMLElement>(`[data-todo-line="${item.line_number}"]`)?.focus();
	}

	async function act(item: TodoFile["items"][number], deleting: boolean) {
		if (disabled || localOperation) return;
		const active = document.activeElement;
		const ownedFocus = !!active && !!list?.contains(active);
		const version = focusVersion;
		const scope = workspaceKey;
		const index = items.indexOf(item);
		localOperation = true;
		try {
			const applied = await (deleting ? onDelete(item) : onToggleComplete(item));
			await tick();
			if (applied === false || !ownedFocus || version !== focusVersion || scope !== workspaceKey)
				return;
			if (!deleting && active?.isConnected && document.activeElement === active) return;
			if (document.activeElement !== document.body && document.activeElement !== active) return;
			const remaining = items.findIndex((candidate) => candidate.line_number === item.line_number);
			if (items.length)
				await focusIndex(
					deleting
						? Math.min(index, items.length - 1)
						: remaining >= 0
							? remaining
							: Math.min(index, items.length - 1)
				);
			else list?.focus();
		} finally {
			localOperation = false;
		}
	}

	function handleKey(
		id: "previous" | "next" | "first" | "last" | "completion",
		event: KeyboardEvent
	) {
		if (shortcutSurfaceOpen() || event.defaultPrevented || !(event.target instanceof HTMLElement))
			return;
		// Nested buttons, checkboxes, and editable content keep their native behavior.
		if (event.target !== list && !event.target.matches("[data-todo-line]")) return;
		if (disabled || localOperation) return;
		event.preventDefault();
		const index = items.findIndex((item) => item.line_number === focusedRow);
		if (id === "completion") {
			if (!event.repeat && index >= 0) void act(items[index], false);
			return;
		}
		const target =
			id === "first"
				? 0
				: id === "last"
					? items.length - 1
					: index < 0
						? 0
						: index + (id === "next" ? 1 : -1);
		void focusIndex(Math.max(0, Math.min(items.length - 1, target)));
	}
	const navigation = createHotkeysAttachment(
		(["previous", "next", "first", "last", "completion"] as const).map((id) => ({
			hotkey: todoShortcuts[id].binding,
			callback: (event) => handleKey(id, event),
		})),
		() => ({ enabled: !disabled, preventDefault: false, stopPropagation: false })
	);

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
</script>

<svelte:document
	onpointerdown={() => {
		focusVersion++;
	}}
	onfocusin={() => {
		focusVersion++;
	}}
/>

<!-- The list is a Tab entry and the empty-list focus fallback; rows use focus-only navigation. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<ul
	bind:this={list}
	{@attach navigation}
	tabindex="0"
	aria-label="Todo items"
	onkeydowncapture={(event) => {
		// Bits UI activates checkboxes on keydown; a held Space must still mutate only once.
		if (
			event.repeat &&
			event.key === " " &&
			event.target instanceof HTMLElement &&
			event.target.closest('[role="checkbox"]')
		) {
			event.preventDefault();
			event.stopPropagation();
		}
	}}
	onfocusin={(event) => {
		if (event.target === list) focusedRow = null;
	}}
	class="relative w-full focus-visible:outline-2 focus-visible:outline-ring"
	style:height={`${items.length ? virtualization.totalSize : 41}px`}
>
	{#each virtualization.rows as { row, item } (row.key)}
		<li
			tabindex="-1"
			data-todo-line={item.line_number}
			class="absolute top-0 left-0 w-full border-b border-border/50 focus-visible:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
			style:height={`${row.size}px`}
			style:transform={`translateY(${row.start}px)`}
			aria-posinset={row.index + 1}
			aria-setsize={items.length}
			onfocusin={() => {
				focusedRow = item.line_number;
				virtualization.focusItem(item);
			}}
			onfocusout={virtualization.onFocusOut}
		>
			<TodoItem
				todo={item}
				{disabled}
				onToggleComplete={(item) => void act(item, false)}
				onDelete={(item) => void act(item, true)}
			/>
		</li>
	{/each}
</ul>
{#if items.length === 0 && showEmptyState}
	<Empty.Root aria-label="No valid Todo items" class="min-h-full rounded-none border-0">
		<Empty.Media variant="icon"><FileText aria-hidden="true" /></Empty.Media>
		<Empty.Header>
			<Empty.Title>No valid Todo items</Empty.Title>
			<Empty.Description>This Todo file did not contain any parsed Todo items.</Empty.Description>
		</Empty.Header>
	</Empty.Root>
{/if}
