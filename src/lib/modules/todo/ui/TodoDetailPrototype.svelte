<script lang="ts">
	// Question: compare a persistent panel, modal Sheet, and inline detail on the existing route.
	import { page } from "$app/state";
	import { MediaQuery } from "svelte/reactivity";
	import { tick } from "svelte";
	import { Button } from "$lib/shared/ui/button";
	import * as Sheet from "$lib/shared/ui/sheet";
	import PrototypeSwitcher from "$lib/shared/ui/PrototypeSwitcher.svelte";
	import type { TodoItem } from "../domain/todo";
	import { validDueDate } from "../domain/todo-due";
	import { prototypeTodoFile } from "./todo-detail-prototype-data";
	import X from "@lucide/svelte/icons/x";
	import Copy from "@lucide/svelte/icons/copy";
	import Check from "@lucide/svelte/icons/check";

	const wide = new MediaQuery("(min-width: 1100px)");
	const variant = $derived(page.url.searchParams.get("variant") ?? "panel");
	const overlay = $derived(variant === "sheet" || (variant === "panel" && !wide.current));
	let selected = $state.raw<TodoItem | null>(prototypeTodoFile.items[0]);
	let open = $state(true);
	let copied = $state(false);
	let rows = $state<HTMLDivElement>();
	let origin = $state<HTMLElement | null>(null);

	function select(todo: TodoItem, trigger: HTMLElement) {
		selected = todo;
		origin = trigger;
		copied = false;
		open = true;
	}
	async function close() {
		open = false;
		await tick();
		origin?.focus();
	}
	function rowKey(event: KeyboardEvent, index: number) {
		if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
		event.preventDefault();
		const next = Math.max(
			0,
			Math.min(prototypeTodoFile.items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))
		);
		const button = rows?.querySelector<HTMLButtonElement>(`[data-item="${next}"]`);
		button?.focus();
		if (open && button) select(prototypeTodoFile.items[next], button);
	}
	async function copyRaw(todo: TodoItem) {
		await navigator.clipboard.writeText(todo.raw);
		copied = true;
	}
	function tokenClass(token: string) {
		// shortcut: fixture-only token colouring; use backend parser spans for production highlighting.
		if (token.startsWith("+")) return "text-[var(--priority-b)]";
		if (token.startsWith("@")) return "text-[var(--priority-c)]";
		if (/^\([A-Z]\)$/.test(token)) return "font-semibold text-[var(--priority-a)]";
		if (token === "due:next-week")
			return "text-destructive underline decoration-dotted underline-offset-4";
		if (/^\d{4}-\d{2}-\d{2}$/.test(token) || token.includes(":")) return "text-muted-foreground";
		return "";
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === "Escape" && !overlay) void close();
	}}
/>

{#snippet detail(todo: TodoItem)}
	<div class="space-y-7 p-6">
		<div>
			<p class="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
				{#if todo.completed}<Check class="size-3.5" />{/if}{todo.completed ? "Completed" : "Open"}
			</p>
			<h2 class="text-xl leading-relaxed font-medium break-words">{todo.description}</h2>
		</div>
		<dl class="space-y-4 text-sm">
			{#if todo.priority}<div class="grid grid-cols-[6rem_1fr] gap-3">
					<dt class="text-muted-foreground">Priority</dt>
					<dd class="font-mono text-[var(--priority-a)]">({todo.priority})</dd>
				</div>{/if}
			{#if todo.metadata.due}<div class="grid grid-cols-[6rem_1fr] gap-3">
					<dt class="text-muted-foreground">Due</dt>
					<dd class={validDueDate(todo.metadata.due) ? "" : "text-destructive"}>
						{todo.metadata.due}{#if !validDueDate(todo.metadata.due)}<p class="mt-1 text-xs">
								Not a valid date
							</p>{/if}
					</dd>
				</div>{/if}
			{#each [{ label: "Projects", prefix: "+", values: todo.projects }, { label: "Contexts", prefix: "@", values: todo.contexts }] as group (group.label)}
				{#if group.values.length}<div class="grid grid-cols-[6rem_1fr] gap-3">
						<dt class="text-muted-foreground">{group.label}</dt>
						<dd class="flex flex-wrap gap-1.5">
							{#each group.values as value (value)}<span
									class={`rounded-md bg-muted px-2 py-1 font-mono text-xs ${tokenClass(group.prefix + value)}`}
									>{group.prefix}{value}</span
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
					<dt class="font-mono text-muted-foreground">{key}</dt>
					<dd class="break-all">{value}</dd>
				</div>{/each}
		</dl>
		<section class="border-t pt-5" aria-label="Raw line">
			<div class="mb-3 flex items-center justify-between">
				<div>
					<h3 class="text-sm font-medium">Raw line</h3>
					<p class="mt-1 text-xs text-muted-foreground">todo.txt · line {todo.line_number}</p>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Copy raw line"
					onclick={() => copyRaw(todo)}
					>{#if copied}<Check class="size-4" />{:else}<Copy class="size-4" />{/if}</Button
				>
			</div>
			<div class="rounded-lg border bg-muted/40 p-4">
				<code class="block font-mono text-xs leading-6 break-words whitespace-pre-wrap"
					>{#each todo.raw.split(/(\s+)/) as token, tokenIndex (tokenIndex)}<span
							class={tokenClass(token)}>{token}</span
						>{/each}</code
				>
			</div>
			<p class="mt-2 text-xs text-muted-foreground" role="status">
				{copied ? "Raw line copied" : "Original spacing and token order preserved."}
			</p>
		</section>
		<p class="text-xs text-muted-foreground">
			Read-only sample · editing and completion are outside this prototype.
		</p>
	</div>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col">
	<header class="flex items-center justify-between border-b px-5 py-3">
		<div>
			<p class="text-sm font-medium">Todo items</p>
			<p class="text-xs text-muted-foreground">6 sample items · Work</p>
		</div>
		<span class="rounded border px-2 py-1 text-xs text-muted-foreground">Detail prototype</span>
	</header>
	<div class="flex min-h-0 flex-1">
		<div class="min-w-0 flex-1 overflow-auto pb-28" bind:this={rows}>
			{#each prototypeTodoFile.items as todo, index (todo.line_number)}
				<Button
					variant="ghost"
					data-item={index}
					aria-label={`View ${todo.description}`}
					aria-expanded={open && selected === todo}
					class={`flex h-10 w-full justify-start gap-3 rounded-none border-b border-border/50 px-5 font-normal ${open && selected === todo ? "bg-accent" : ""}`}
					onclick={(event) => select(todo, event.currentTarget)}
					onkeydown={(event) => rowKey(event, index)}
				>
					<span
						class={`flex size-4 shrink-0 items-center justify-center rounded-full border ${todo.completed ? "border-[var(--completed)] bg-[var(--completed)] text-white" : "border-muted-foreground/40"}`}
						>{#if todo.completed}<Check class="size-3" />{/if}</span
					>
					<span class="w-6 shrink-0 font-mono text-xs text-muted-foreground"
						>{todo.priority ? `(${todo.priority})` : "—"}</span
					>
					<span
						class={`min-w-0 flex-1 truncate text-left text-sm ${todo.completed ? "text-muted-foreground line-through" : ""}`}
						>{todo.description}</span
					>
					<span class="hidden shrink-0 font-mono text-xs text-[var(--priority-b)] xl:inline"
						>{todo.projects[0] ? `+${todo.projects[0]}` : ""}</span
					>
				</Button>
				{#if variant === "inline" && open && selected === todo}<div class="border-b bg-muted/10">
						<div class="flex justify-end px-4 pt-2">
							<Button variant="ghost" size="icon-sm" aria-label="Close details" onclick={close}
								><X class="size-4" /></Button
							>
						</div>
						{@render detail(todo)}
					</div>{/if}
			{/each}
			<p class="px-5 py-6 text-xs text-muted-foreground">
				Click an item to inspect it. ↑ ↓ browse the list.
			</p>
		</div>
		{#if variant === "panel" && !overlay && selected && open}
			<aside
				aria-label="Todo item details"
				class="w-[400px] shrink-0 overflow-auto border-l bg-background pb-24"
			>
				<div class="flex h-12 items-center justify-between border-b px-6">
					<p class="text-xs font-medium text-muted-foreground">Todo item details</p>
					<Button variant="ghost" size="icon-sm" aria-label="Close details" onclick={close}
						><X class="size-4" /></Button
					>
				</div>
				{@render detail(selected)}
			</aside>
		{/if}
	</div>
	{#if overlay}
		<Sheet.Root
			bind:open
			onOpenChange={(value) => {
				if (!value) void close();
			}}
			><Sheet.Content class="w-full overflow-auto pb-24 sm:max-w-[440px]"
				><Sheet.Header
					><Sheet.Title>Todo item details</Sheet.Title><Sheet.Description
						>Work · read-only sample</Sheet.Description
					></Sheet.Header
				>{#if selected}{@render detail(selected)}{/if}
				<PrototypeSwitcher
					onSwitch={() => {
						open = true;
						copied = false;
					}}
				/></Sheet.Content
			></Sheet.Root
		>
	{/if}
</div>

{#if !overlay || !open}<PrototypeSwitcher
		onSwitch={() => {
			open = true;
			copied = false;
		}}
	/>
{/if}
