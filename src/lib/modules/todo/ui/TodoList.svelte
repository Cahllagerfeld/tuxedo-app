<script lang="ts">
	import type { TodoFile } from "$lib/modules/todo/domain/todo";
	import * as Empty from "$lib/shared/ui/empty";
	import FileText from "@lucide/svelte/icons/file-text";
	import { createHotkeysAttachment } from "@tanstack/svelte-hotkeys";
	import { tick } from "svelte";
	import TodoItem from "./TodoItem.svelte";

	type TodoListProps = {
		todoFile: TodoFile;
		disabled: boolean;
		onToggleComplete: (todo: TodoFile["items"][number]) => void | Promise<void>;
		onDelete: (todo: TodoFile["items"][number]) => void | Promise<void>;
	};

	let { todoFile, disabled, onToggleComplete, onDelete }: TodoListProps = $props();
	let rows = $state<HTMLElement[]>([]);
	let emptyState = $state<HTMLElement | null>(null);

	function focusRow(index: number) {
		const targetIndex = Math.max(0, Math.min(index, todoFile.items.length - 1));
		rows[targetIndex]?.focus();
		rows[targetIndex]?.scrollIntoView({ block: "nearest" });
	}

	function rowHotkeys(item: TodoFile["items"][number], index: number) {
		const handle = (event: KeyboardEvent, targetIndex: number) => {
			if (event.target !== rows[index]) return;
			event.preventDefault();
			focusRow(targetIndex);
		};
		return createHotkeysAttachment(
			[
				{
					hotkey: "ArrowDown",
					callback: (event) => handle(event, Math.min(index + 1, todoFile.items.length - 1)),
				},
				{ hotkey: "ArrowUp", callback: (event) => handle(event, Math.max(index - 1, 0)) },
				{ hotkey: "Home", callback: (event) => handle(event, 0) },
				{ hotkey: "End", callback: (event) => handle(event, todoFile.items.length - 1) },
				{
					hotkey: "Space",
					callback: (event) => {
						if (event.target !== rows[index] || disabled) return;
						event.preventDefault();
						void completeAndRecoverFocus(item, index);
					},
					options: () => ({ enabled: !disabled, requireReset: true }),
				},
			],
			{ preventDefault: false, stopPropagation: false, ignoreInputs: true }
		);
	}

	async function completeAndRecoverFocus(item: TodoFile["items"][number], index: number) {
		const origin = rows[index];
		const filePath = todoFile.path;
		await onToggleComplete(item);
		await tick();
		if (todoFile.path !== filePath || !origin?.isConnected) return;
		if (document.activeElement !== document.body && document.activeElement !== origin) return;
		focusRow(Math.min(index, todoFile.items.length - 1));
	}

	async function deleteAndRecoverFocus(item: TodoFile["items"][number], index: number) {
		const origin = document.activeElement;
		const filePath = todoFile.path;
		const matchingRawCount = todoFile.items.filter(({ raw }) => raw === item.raw).length;
		await onDelete(item);
		await tick();
		if (todoFile.path !== filePath) return;
		if (document.activeElement !== document.body && document.activeElement !== origin) return;
		if (todoFile.items.filter(({ raw }) => raw === item.raw).length >= matchingRawCount) return;
		if (todoFile.items.length === 0) {
			emptyState?.focus();
			return;
		}
		focusRow(Math.min(index, todoFile.items.length - 1));
	}
</script>

{#if todoFile.items.length > 0}
	<ul aria-label="Todo items" class="-mx-4 w-full divide-y">
		{#each todoFile.items as item, index (item.line_number)}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (focus target for TanStack Hotkeys) -->
			<li
				bind:this={rows[index]}
				{@attach rowHotkeys(item, index)}
				tabindex={0}
				class="outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
			>
				{#key item.raw}
					<TodoItem
						todo={item}
						{disabled}
						{onToggleComplete}
						onDelete={() => void deleteAndRecoverFocus(item, index)}
					/>
				{/key}
			</li>
		{/each}
	</ul>
{:else}
	<Empty.Root
		bind:ref={emptyState}
		tabindex={-1}
		aria-label="No valid Todo items"
		class="min-h-full rounded-none border-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
	>
		<Empty.Media variant="icon"><FileText aria-hidden="true" /></Empty.Media>
		<Empty.Header>
			<Empty.Title>No valid Todo items</Empty.Title>
			<Empty.Description>This Todo file did not contain any parsed Todo items.</Empty.Description>
		</Empty.Header>
	</Empty.Root>
{/if}
