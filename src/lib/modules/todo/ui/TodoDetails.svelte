<script lang="ts">
	import type { TodoItem } from "../domain/todo";
	import { validDueDate } from "../domain/todo-due";
	import { Button } from "$lib/shared/ui/button";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import * as DropdownMenu from "$lib/shared/ui/dropdown-menu";
	import { toast } from "svelte-sonner";
	import X from "@lucide/svelte/icons/x";
	import Copy from "@lucide/svelte/icons/copy";
	import Check from "@lucide/svelte/icons/check";
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
	let copiedRaw = $state<string | null>(null);
	let menuTrigger = $state<HTMLButtonElement | null>(null);
	const filename = $derived(path.split(/[\\/]/u).at(-1) ?? path);
	const projects = $derived(new Set(todo.projects.map((value) => `+${value}`)));
	const contexts = $derived(new Set(todo.contexts.map((value) => `@${value}`)));
	const metadata = $derived(new Set(todo.edit.metadata));
	async function copyRaw() {
		const raw = todo.raw;
		try {
			await navigator.clipboard.writeText(raw);
			copiedRaw = raw;
		} catch {
			toast.error("Could not copy raw line");
		}
	}
</script>

<div data-todo-details class="flex h-full min-h-0 flex-col">
	<div class="flex h-12 shrink-0 items-center justify-between border-b px-6">
		<p class="text-xs font-medium text-muted-foreground">Todo item details</p>
		<Button variant="ghost" size="icon-sm" aria-label="Close details" onclick={onClose}
			><X aria-hidden="true" /></Button
		>
	</div>
	<ScrollArea class="min-h-0 flex-1" aria-label="Todo item details content" viewportTabIndex={-1}>
		<div class="space-y-6 p-6">
			<div>
				<p class="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
					{#if todo.completed}<Check class="size-3.5" aria-hidden="true" />{/if}{todo.completed
						? "Completed"
						: "Open"}
				</p>
				<h2 class="text-xl leading-relaxed font-medium break-words">{todo.description}</h2>
				<div class="mt-4 flex flex-wrap items-center gap-2">
					<Button variant="outline" size="sm" {disabled} onclick={() => onToggleComplete(todo)}
						>{#if !todo.completed}<Check aria-hidden="true" />{/if}{todo.completed
							? "Mark incomplete"
							: "Mark complete"}</Button
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
			<section class="border-t pt-5" aria-label="Raw line">
				<div class="mb-3 flex items-center justify-between gap-2">
					<div class="min-w-0">
						<h3 class="text-sm font-medium">Raw line</h3>
						<p class="mt-1 text-xs break-all text-muted-foreground" title={path}>
							{filename} · line {todo.line_number}
						</p>
					</div>
					<Button variant="ghost" size="icon-sm" aria-label="Copy raw line" onclick={copyRaw}
						>{#if copiedRaw === todo.raw}<Check aria-hidden="true" />{:else}<Copy
								aria-hidden="true"
							/>{/if}</Button
					>
				</div>
				<div class="rounded-lg border bg-muted/40 p-4">
					<code class="block font-mono text-xs leading-6 break-words whitespace-pre-wrap"
						>{#each todo.raw.split(/(\p{White_Space}+)/u) as token, index (index)}<span
								class={projects.has(token)
									? "text-[var(--priority-b)]"
									: contexts.has(token)
										? "text-[var(--priority-c)]"
										: metadata.has(token)
											? "text-muted-foreground"
											: ""}>{token}</span
							>{/each}</code
					>
				</div>
				<p role="status" class="mt-2 text-xs text-muted-foreground">
					{copiedRaw === todo.raw
						? "Raw line copied"
						: "Original spacing and token order preserved."}
				</p>
			</section>
		</div>
	</ScrollArea>
</div>
