<script lang="ts">
	import type { TodoItem } from "../domain/todo";
	import TodoRawLine from "./TodoRawLine.svelte";
	import { validDueDate } from "../domain/todo-due";
	import { Button } from "$lib/shared/ui/button";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import * as DropdownMenu from "$lib/shared/ui/dropdown-menu";
	import X from "@lucide/svelte/icons/x";
	import Check from "@lucide/svelte/icons/check";
	import Undo2 from "@lucide/svelte/icons/undo-2";
	import Pencil from "@lucide/svelte/icons/pencil";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import Trash2 from "@lucide/svelte/icons/trash-2";

	let {
		todo,
		path,
		disabled,
		onClose,
		onEdit,
		onToggleComplete,
		onDelete,
	}: {
		todo: TodoItem;
		path: string;
		disabled: boolean;
		onClose: () => void;
		onEdit: (todo: TodoItem, trigger: HTMLButtonElement | null) => void;
		onToggleComplete: (todo: TodoItem) => void;
		onDelete: (todo: TodoItem, trigger?: HTMLButtonElement | null) => void;
	} = $props();
	let menuTrigger = $state<HTMLButtonElement | null>(null);
	const projects = $derived(new Set(todo.projects.map((value) => `+${value}`)));
	const contexts = $derived(new Set(todo.contexts.map((value) => `@${value}`)));
</script>

<div data-todo-details class="relative flex h-full min-h-0 flex-col">
	<Button
		variant="ghost"
		size="icon-sm"
		class="absolute top-4 right-4 z-10"
		aria-label="Close details"
		onclick={onClose}><X aria-hidden="true" /></Button
	>
	<ScrollArea class="min-h-0 flex-1" aria-label="Todo item details content" viewportTabIndex={-1}>
		<div class="space-y-6 p-6">
			<div>
				<h2 class="pr-10 text-xl leading-relaxed font-medium break-words">{todo.description}</h2>
				<div class="mt-4 flex flex-wrap items-center gap-2">
					<Button variant="outline" size="sm" {disabled} onclick={() => onToggleComplete(todo)}
						>{#if todo.completed}<Undo2 aria-hidden="true" />{:else}<Check
								aria-hidden="true"
							/>{/if}{todo.completed ? "Mark incomplete" : "Mark complete"}</Button
					>
					<Button
						variant="ghost"
						size="sm"
						{disabled}
						onclick={(event) =>
							onEdit(
								todo,
								event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null
							)}><Pencil aria-hidden="true" />Edit</Button
					>
					<DropdownMenu.Root
						><DropdownMenu.Trigger
							>{#snippet child({ props })}<Button
									{...props}
									bind:ref={menuTrigger}
									variant="ghost"
									size="icon-sm"
									{disabled}
									aria-label="Detail actions"><Ellipsis aria-hidden="true" /></Button
								>{/snippet}</DropdownMenu.Trigger
						><DropdownMenu.Content align="end"
							><DropdownMenu.Item
								{disabled}
								variant="destructive"
								onSelect={() => onDelete(todo, menuTrigger)}
								><Trash2 aria-hidden="true" />Delete</DropdownMenu.Item
							></DropdownMenu.Content
						></DropdownMenu.Root
					>
				</div>
			</div>
			<dl class="space-y-4 text-sm">
				{#if todo.priority}<div class="grid grid-cols-[6rem_1fr] gap-3">
						<dt class="text-muted-foreground">Priority</dt>
						<dd
							class={`font-mono ${todo.priority === "A" ? "text-[var(--priority-a)]" : todo.priority === "B" ? "text-[var(--priority-b)]" : todo.priority === "C" ? "text-[var(--priority-c)]" : ""}`}
						>
							({todo.priority})
						</dd>
					</div>{/if}
				{#if todo.metadata.due !== undefined}<div class="grid grid-cols-[6rem_1fr] gap-3">
						<dt class="text-muted-foreground">Due</dt>
						<dd class={validDueDate(todo.metadata.due) ? "" : "text-destructive"}>
							{todo.metadata.due}{#if !validDueDate(todo.metadata.due)}<p class="mt-1 text-xs">
									Not a valid date
								</p>{/if}
						</dd>
					</div>{/if}
				{#each [{ label: "Projects", values: projects, color: "text-[var(--priority-b)]" }, { label: "Contexts", values: contexts, color: "text-[var(--priority-c)]" }] as group (group.label)}
					{#if group.values.size}<div class="grid grid-cols-[6rem_1fr] gap-3">
							<dt class="text-muted-foreground">{group.label}</dt>
							<dd class="flex flex-wrap gap-1.5">
								{#each [...group.values] as value (value)}<span
										class={`max-w-full rounded-md bg-muted px-2 py-1 font-mono text-xs break-all ${group.color}`}
										>{value}</span
									>{/each}
							</dd>
						</div>{/if}
				{/each}
				{#if todo.creation_date}<div class="grid grid-cols-[6rem_1fr] gap-3">
						<dt class="text-muted-foreground">Created</dt>
						<dd>{todo.creation_date}</dd>
					</div>{/if}
				{#if todo.completion_date}<div class="grid grid-cols-[6rem_1fr] gap-3">
						<dt class="text-muted-foreground">Completed</dt>
						<dd>{todo.completion_date}</dd>
					</div>{/if}
				{#each Object.entries(todo.metadata).filter(([key]) => key !== "due") as [key, value] (key)}<div
						class="grid grid-cols-[6rem_1fr] gap-3"
					>
						<dt class="font-mono break-all text-muted-foreground">{key}</dt>
						<dd class="break-all">{value}</dd>
					</div>{/each}
			</dl>
			<TodoRawLine {todo} {path} />
		</div>
	</ScrollArea>
</div>
