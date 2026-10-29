<script lang="ts">
	import type { TodoItem } from "../domain/todo";
	import { boardAssignment, type BoardColumn } from "@tuxedo/contracts/board";
	import * as DropdownMenu from "#lib/shared/ui/dropdown-menu/index.js";
	import { Button } from "#lib/shared/ui/button/index.js";
	import GripVertical from "@lucide/svelte/icons/grip-vertical";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import { dueCategory, validDueDate } from "../domain/todo-due";
	import { recurrenceLabel } from "../domain/todo-recurrence";
	import { isDeferred, showFromDate } from "../domain/todo-threshold";
	import { Checkbox } from "#lib/shared/ui/checkbox/index.js";
	import { cn } from "cn";

	let {
		todo,
		today,
		disabled,
		selectedTodo,
		onOpen,
		onToggleComplete,
		onMove,
		onDragStart,
		onDragEnd,
	}: {
		todo: TodoItem;
		today: string;
		disabled: boolean;
		selectedTodo: TodoItem | null;
		onOpen: (todo: TodoItem, trigger: HTMLElement) => void;
		onToggleComplete: (todo: TodoItem) => void;
		onMove?: (todo: TodoItem, column: BoardColumn, trigger?: HTMLButtonElement | null) => void;
		onDragStart: (todo: TodoItem, event: DragEvent) => void;
		onDragEnd: () => void;
	} = $props();
	let moveTrigger = $state<HTMLButtonElement | null>(null);
	const assignment = $derived(boardAssignment(todo.metadata.board));
	const destinations = [
		{ id: "unassigned", name: "Unassigned" },
		{ id: "to-do", name: "To do" },
		{ id: "in-progress", name: "In progress" },
	] as const;
	let confirmedChecked = $derived(todo.completed);
	const due = $derived(validDueDate(todo.metadata.due));
	const category = $derived(dueCategory(todo.metadata.due, today));
	const recurrence = $derived(recurrenceLabel(todo.metadata.rec));
	const showFrom = $derived(showFromDate(todo));
	const deferred = $derived(isDeferred(todo, today));
	const selected = $derived(
		selectedTodo?.line_number === todo.line_number && selectedTodo?.raw === todo.raw
	);
	const indicatorsId = $props.id();
</script>

<article
	data-board-line={todo.line_number}
	class={cn(
		"relative isolate flex items-start gap-2 rounded-md border bg-background p-3 shadow-sm",
		selected && "ring-2 ring-ring",
		deferred && "border-amber-500/40"
	)}
>
	<Checkbox
		bind:checked={confirmedChecked}
		{disabled}
		data-board-completion
		aria-label={`Mark ${todo.description} ${todo.completed ? "incomplete" : "complete"}`}
		class="relative z-10 mt-0.5 size-4 rounded-full data-checked:border-[var(--completed)] data-checked:bg-[var(--completed)]"
		onCheckedChange={() => {
			confirmedChecked = todo.completed;
			onToggleComplete(todo);
		}}
	/>
	<button
		type="button"
		data-board-open
		aria-label={`Open ${todo.description}`}
		aria-describedby={indicatorsId}
		aria-expanded={selected}
		{disabled}
		class="min-w-0 flex-1 rounded text-left before:absolute before:inset-0 before:-z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed"
		onclick={(event) => onOpen(todo, event.currentTarget)}
	>
		<span
			class={cn(
				"block text-sm font-medium break-words",
				todo.completed && "text-muted-foreground line-through"
			)}
		>
			{todo.description}
		</span>
		<span
			id={indicatorsId}
			class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
		>
			{#if todo.priority}<span title="Priority"
					><span class="sr-only">Priority </span>({todo.priority})</span
				>{/if}
			{#each [...new Set(todo.projects)] as project (project)}<span>+{project}</span>{/each}
			{#each [...new Set(todo.contexts)] as context (context)}<span>@{context}</span>{/each}
			{#if recurrence}<span title={`Recurrence: ${recurrence}`}>Recurring</span>{/if}
			{#if assignment.invalid}
				<span
					class="text-destructive"
					title="Move this Todo item to replace its invalid board assignment"
					>Invalid board assignment</span
				>
			{/if}
			{#if showFrom}
				<span title={`Show from ${showFrom}${deferred ? " · Deferred" : ""}`}>
					{deferred ? "Deferred · " : ""}Show from {showFrom}
				</span>
			{:else if todo.metadata.t !== undefined}
				<span
					class="text-destructive"
					title={`Invalid or unsupported Show from: ${todo.metadata.t}`}>Invalid Show from</span
				>
			{/if}
			{#if todo.completed && todo.completion_date}
				<span title={`Completed ${todo.completion_date}`}>Completed {todo.completion_date}</span>
			{:else if !todo.completed && due}
				<span
					class={category === "overdue" ? "text-destructive" : undefined}
					title={`${category === "today" ? "Today ·" : category === "overdue" ? "Overdue ·" : "Due"} ${due}`}
					>Due {due}</span
				>
			{:else if !todo.completed && category === "invalid"}
				<span class="text-destructive" title="Invalid due date">Invalid due date</span>
			{/if}
		</span>
	</button>
	{#if !todo.completed && onMove}
		<span
			aria-hidden="true"
			title={`Drag ${todo.description}`}
			draggable={!disabled}
			ondragstart={(event) => onDragStart(todo, event)}
			ondragend={onDragEnd}
			class="relative z-10 cursor-grab text-muted-foreground active:cursor-grabbing"
			><GripVertical class="size-4" /></span
		>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						bind:ref={moveTrigger}
						variant="ghost"
						size="icon-xs"
						{disabled}
						aria-label={`Move ${todo.description}`}
						class="relative z-10"><Ellipsis aria-hidden="true" /></Button
					>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				<DropdownMenu.Label>Move to</DropdownMenu.Label>
				{#each destinations as destination}
					<DropdownMenu.Item
						disabled={disabled || (assignment.column === destination.id && !assignment.invalid)}
						onSelect={() => onMove?.(todo, destination.id, moveTrigger)}
						>{destination.name}</DropdownMenu.Item
					>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/if}
</article>
