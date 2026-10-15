<script lang="ts">
	import TodoShowFrom from "./TodoShowFrom.svelte";
	import type { TodoItem } from "$lib/modules/todo/domain/todo";
	import { badgeVariants } from "$lib/shared/ui/badge";
	import { Button } from "$lib/shared/ui/button";
	import { Checkbox } from "$lib/shared/ui/checkbox";
	import { cn } from "cn";
	import * as Tooltip from "$lib/shared/ui/tooltip";
	import * as DropdownMenu from "$lib/shared/ui/dropdown-menu";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import Pencil from "@lucide/svelte/icons/pencil";
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
	import CalendarDays from "@lucide/svelte/icons/calendar-days";
	import Check from "@lucide/svelte/icons/check";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import { dueCategory, validDueDate } from "../domain/todo-due";

	type TodoItemProps = {
		todo: TodoItem;
		today: string;
		disabled: boolean;
		onToggleComplete: (todo: TodoItem) => void;
		onDelete: (todo: TodoItem, trigger?: HTMLButtonElement | null) => void;
		onEdit?: (todo: TodoItem, trigger: HTMLButtonElement | null) => void;
	};

	let { todo, today, disabled, onToggleComplete, onDelete, onEdit }: TodoItemProps = $props();
	const due = $derived(validDueDate(todo.metadata.due));
	const category = $derived(dueCategory(todo.metadata.due, today));
	let menuTrigger = $state<HTMLButtonElement | null>(null);
	let confirmedChecked = $derived(todo.completed);
	const projects = $derived([...new Set(todo.projects)]);
	const contexts = $derived([...new Set(todo.contexts)]);
	const tagGroups = $derived([
		{ label: "Projects", prefix: "+", values: projects, limit: contexts.length ? 1 : 2 },
		{ label: "Contexts", prefix: "@", values: contexts, limit: projects.length ? 1 : 2 },
	]);
	const rowDate = $derived(todo.completed ? todo.completion_date : due);

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
	class={cn(
		"@container flex h-10 min-w-0 items-center gap-2 px-3",
		todo.completed && "text-muted-foreground"
	)}
>
	<Checkbox
		bind:checked={confirmedChecked}
		{disabled}
		aria-label={`Mark ${todo.description} ${todo.completed ? "incomplete" : "complete"}`}
		class="pointer-events-auto size-4 shrink-0 rounded-full data-checked:border-[var(--completed)] data-checked:bg-[var(--completed)]"
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
		class="hidden max-w-[25%] min-w-0 shrink items-center gap-2 overflow-hidden font-mono text-xs text-muted-foreground sm:flex"
	>
		<Tooltip.Provider>
			{#each tagGroups as group (group.label)}
				{#if group.values.length}
					<div
						class={cn(
							"flex min-w-0 items-center gap-1",
							group.prefix === "+" && "text-[var(--priority-b)]"
						)}
					>
						{#each group.values.slice(0, group.limit) as value (value)}
							<span class="min-w-0 truncate" title={`${group.prefix}${value}`}
								>{group.prefix}{value}</span
							>
						{/each}
						{#if group.values.length > group.limit}
							<Tooltip.Root>
								<Tooltip.Trigger
									aria-label={`${group.values.length - group.limit} more ${group.label}`}
									class={cn("pointer-events-auto", badgeVariants({ variant: "overflow" }))}
									>+{group.values.length - group.limit}</Tooltip.Trigger
								>
								<Tooltip.Content role="tooltip" class="flex-col items-start font-mono">
									{#each group.values.slice(group.limit) as value (value)}
										<span class="break-all">{group.prefix}{value}</span>
									{/each}
								</Tooltip.Content>
							</Tooltip.Root>
						{/if}
					</div>
				{/if}
			{/each}
		</Tooltip.Provider>
	</div>
	{#if todo.metadata.t !== undefined}
		<div class="max-w-[40%] min-w-0 shrink"><TodoShowFrom {todo} {today} /></div>
	{/if}
	{#if rowDate}
		<span
			class={cn(
				"flex shrink-0 items-center gap-1 truncate rounded px-1.5 py-0.5 text-xs tabular-nums",
				!todo.completed && category === "overdue"
					? "bg-destructive/10 text-destructive"
					: !todo.completed && category === "today"
						? "bg-accent text-accent-foreground"
						: "text-muted-foreground"
			)}
			title={`${todo.completed ? "Completed" : category === "today" ? "Today ·" : category === "overdue" ? "Overdue ·" : "Due"} ${rowDate}`}
		>
			{#if todo.completed}<Check class="size-3 shrink-0" aria-hidden="true" />{:else}<CalendarDays
					class="size-3 shrink-0"
					aria-hidden="true"
				/>{/if}
			<span class="sr-only">{todo.completed ? "Completed" : "Due"} </span>
			<time class="sr-only @min-[20rem]:not-sr-only" datetime={rowDate}>{rowDate}</time>
		</span>
	{:else if !todo.completed && category === "invalid"}
		<Tooltip.Provider>
			<Tooltip.Root>
				<Tooltip.Trigger
					aria-label="Invalid due date"
					class="pointer-events-auto shrink-0 rounded text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
				>
					<TriangleAlert class="size-3.5" aria-hidden="true" />
				</Tooltip.Trigger>
				<Tooltip.Content role="tooltip"
					>Invalid due date — edit this Todo item to repair it.</Tooltip.Content
				>
			</Tooltip.Root>
		</Tooltip.Provider>
	{/if}
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
					class="pointer-events-auto shrink-0 opacity-0 transition-none group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
					><Ellipsis aria-hidden="true" /></Button
				>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end">
			<DropdownMenu.Item disabled={disabled || !onEdit} onSelect={() => onEdit?.(todo, menuTrigger)}
				><Pencil aria-hidden="true" />Edit</DropdownMenu.Item
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
