<script lang="ts">
	import type { TodoItem } from "../domain/todo";
	import { Button } from "#lib/shared/ui/button/index.js";
	import { toast } from "svelte-sonner";
	import Copy from "@lucide/svelte/icons/copy";
	import Check from "@lucide/svelte/icons/check";
	let { todo, path }: { todo: TodoItem; path: string } = $props();
	let copiedRaw = $state<string | null>(null);
	const filename = $derived(path.split(/[\\/]/u).at(-1) ?? path);
	const projects = $derived(new Set(todo.projects.map((value) => `+${value}`)));
	const contexts = $derived(new Set(todo.contexts.map((value) => `@${value}`)));
	const metadata = $derived(new Set(todo.edit.metadata));
	async function copyRaw() {
		const raw = todo.raw;
		copiedRaw = null;
		try {
			await window.desktop.writeClipboardText({ text: raw });
			copiedRaw = raw;
		} catch {
			toast.error("Could not copy raw line");
		}
	}
</script>

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
	{#if copiedRaw === todo.raw}
		<p role="status" class="mt-2 text-xs text-muted-foreground">Raw line copied</p>
	{/if}
</section>
