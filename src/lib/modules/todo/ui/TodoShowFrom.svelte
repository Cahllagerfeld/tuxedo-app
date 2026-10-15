<script lang="ts">
	import { Badge } from "$lib/shared/ui/badge";
	import Clock from "@lucide/svelte/icons/clock";
	import type { TodoItem } from "../domain/todo";
	import { isDeferred, showFromDate } from "../domain/todo-threshold";

	let { todo, today }: { todo: TodoItem; today: string } = $props();
	const date = $derived(showFromDate(todo));
	const deferred = $derived(isDeferred(todo, today));
</script>

{#if date}
	<span
		class="inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground tabular-nums"
		title={`Show from ${date}${deferred ? " · Deferred" : ""}`}
	>
		{#if deferred}
			<Badge
				variant="outline"
				class="border-amber-600/25 bg-amber-500/10 text-amber-800 dark:border-amber-400/25 dark:text-amber-300"
				><Clock aria-hidden="true" /><span>Deferred</span></Badge
			>
		{/if}
		<span class="min-w-0 truncate">Show from <time datetime={date}>{date}</time></span>
	</span>
{:else if todo.metadata.t !== undefined}
	<span
		class="block truncate text-xs text-destructive"
		title={`Invalid or unsupported Show from: ${todo.metadata.t}`}
	>
		Invalid or unsupported Show from: {todo.metadata.t}
	</span>
{/if}
