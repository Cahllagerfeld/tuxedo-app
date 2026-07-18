<script lang="ts">
	import type { TodoItem } from "$lib/modules/todo/domain/todo";
	import { Button } from "$lib/shared/ui/button";
	import { Checkbox } from "$lib/shared/ui/checkbox";
	import { cn } from "$lib/shared/utils";
	import Trash2 from "@lucide/svelte/icons/trash-2";

	type TodoItemProps = {
		todo: TodoItem;
		disabled: boolean;
		onToggleComplete: (todo: TodoItem) => void;
		onDelete: (todo: TodoItem) => void;
	};

	let { todo, disabled, onToggleComplete, onDelete }: TodoItemProps = $props();
	let confirmedChecked = $derived(todo.completed);

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
		"group flex gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50",
		todo.completed && "text-muted-foreground opacity-60"
	)}
>
	<div class="pt-0.5">
		<Checkbox
			bind:checked={confirmedChecked}
			{disabled}
			aria-label={`Mark ${todo.description} ${todo.completed ? "incomplete" : "complete"}`}
			class="size-4 rounded-full data-checked:border-[var(--completed)] data-checked:bg-[var(--completed)]"
			onCheckedChange={requestCompletionChange}
		/>
	</div>
	<div class="min-w-0 flex-1 space-y-1">
		<div class="flex min-w-0 items-baseline gap-2">
			{#if todo.priority}
				<span
					class={cn(
						"shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-medium",
						priorityClass(todo.priority)
					)}
				>
					({todo.priority})
				</span>
			{/if}
			<p class={cn("min-w-0 text-sm leading-5", todo.completed && "line-through")}>
				{todo.description}
			</p>
		</div>
		{#if todo.creation_date || todo.completion_date || todo.projects.length || todo.contexts.length || Object.keys(todo.metadata).length}
			<div class="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-xs text-muted-foreground">
				{#if todo.completed && todo.completion_date}
					<span>Completed {todo.completion_date}</span>
				{/if}
				{#if todo.creation_date}
					<span>Created {todo.creation_date}</span>
				{/if}
				{#each todo.projects as project (project)}
					<span class="text-[var(--priority-b)]">+{project}</span>
				{/each}
				{#each todo.contexts as context (context)}
					<span class="text-[var(--priority-c)]">@{context}</span>
				{/each}
				{#each Object.entries(todo.metadata) as [key, value] (key)}
					<span>{key}:{value}</span>
				{/each}
			</div>
		{/if}
	</div>
	<div class="flex shrink-0 self-center">
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			{disabled}
			aria-label={`Delete ${todo.description}`}
			class="opacity-0 transition-none group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-0 group-hover:disabled:opacity-100 focus-visible:disabled:opacity-100"
			onclick={() => onDelete(todo)}
		>
			<Trash2 aria-hidden="true" />
		</Button>
	</div>
</div>
