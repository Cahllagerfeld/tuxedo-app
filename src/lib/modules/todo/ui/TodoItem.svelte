<script lang="ts">
	import { rowShortcuts } from "./shortcuts";
	import ShortcutHint from "$lib/shared/shortcuts/ShortcutHint.svelte";
	import type { TodoItem } from "$lib/modules/todo/domain/todo";
	import { Button } from "$lib/shared/ui/button";
	import { Checkbox } from "$lib/shared/ui/checkbox";
	import { cn } from "cn";
	import * as DropdownMenu from "$lib/shared/ui/dropdown-menu";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import Pencil from "@lucide/svelte/icons/pencil";
	import Trash2 from "@lucide/svelte/icons/trash-2";

	type TodoItemProps = {
		todo: TodoItem;
		disabled: boolean;
		onToggleComplete: (todo: TodoItem) => void;
		onDelete: (todo: TodoItem, trigger?: HTMLButtonElement | null) => void;
		onEdit?: (todo: TodoItem, trigger: HTMLButtonElement | null) => void;
	};

	let { todo, disabled, onToggleComplete, onDelete, onEdit }: TodoItemProps = $props();
	let menuTrigger = $state<HTMLButtonElement | null>(null);
	let confirmedChecked = $derived(todo.completed);
	const projects = $derived([...new Set(todo.projects)]);
	const contexts = $derived([...new Set(todo.contexts)]);

	function requestCompletionChange() {
		confirmedChecked = todo.completed;
		onToggleComplete(todo);
	}

	function priorityClass(priority: string) {
		if (priority === "A") return "bg-[var(--priority-a-muted)] text-[var(--priority-a)]";
		if (priority === "B") return "bg-[var(--priority-b-muted)] text-[var(--priority-b)]";
		if (priority === "C") return "bg-[var(--priority-c-muted)] text-[var(--priority-c)]";
		return "bg-muted text-muted-foreground";
	}
</script>

<div
	class={cn("flex h-10 min-w-0 items-center gap-3 px-4", todo.completed && "text-muted-foreground")}
>
	<Checkbox
		bind:checked={confirmedChecked}
		{disabled}
		aria-label={`Mark ${todo.description} ${todo.completed ? "incomplete" : "complete"}`}
		class="size-4 shrink-0 rounded-full data-checked:border-[var(--completed)] data-checked:bg-[var(--completed)]"
		onCheckedChange={requestCompletionChange}
	/>
	<span
		class={cn(
			"w-6 shrink-0 text-center font-mono text-xs",
			todo.priority ? priorityClass(todo.priority) : "text-muted-foreground"
		)}
	>
		{todo.priority ? `(${todo.priority})` : "—"}
	</span>
	<p class={cn("min-w-0 flex-1 truncate text-sm", todo.completed && "line-through")}>
		{todo.description}
	</p>
	<div
		class="hidden max-w-[35%] shrink-0 items-center gap-2 overflow-hidden font-mono text-xs text-muted-foreground sm:flex"
	>
		{#each projects as project (project)}<span class="truncate text-[var(--priority-b)]"
				>+{project}</span
			>{/each}
		{#each contexts as context (context)}<span class="truncate">@{context}</span>{/each}
	</div>
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					bind:ref={menuTrigger}
					type="button"
					variant="ghost"
					size="icon-xs"
					{disabled}
					aria-label={`Actions for ${todo.description}`}
					class="shrink-0 opacity-0 transition-none group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
					><Ellipsis aria-hidden="true" /></Button
				>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end">
			<DropdownMenu.Item disabled={disabled || !onEdit} onSelect={() => onEdit?.(todo, menuTrigger)}
				><Pencil aria-hidden="true" />Edit <ShortcutHint
					hotkey={rowShortcuts.edit.key}
				/></DropdownMenu.Item
			>
			<DropdownMenu.Separator />
			<DropdownMenu.Item
				{disabled}
				variant="destructive"
				onSelect={() => onDelete(todo, menuTrigger)}
				><Trash2 aria-hidden="true" />Delete</DropdownMenu.Item
			>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
