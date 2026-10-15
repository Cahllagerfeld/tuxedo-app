<script lang="ts">
	import type { TodoItem } from "../domain/todo";
	import { isDeferred, showFromDate } from "../domain/todo-threshold";

	let { todo, today }: { todo: TodoItem; today: string } = $props();
	const date = $derived(showFromDate(todo));
	const deferred = $derived(isDeferred(todo, today));
</script>

{#if date}
	<span
		class={`block truncate rounded px-1.5 py-0.5 text-xs tabular-nums ${deferred ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}
		title={`Show from ${date}${deferred ? " · Deferred" : ""}`}
	>
		Show from <time datetime={date}>{date}</time>{deferred ? " · Deferred" : ""}
	</span>
{:else if todo.metadata.t !== undefined}
	<span
		class="block truncate text-xs text-destructive"
		title={`Invalid or unsupported Show from: ${todo.metadata.t}`}
	>
		Invalid or unsupported Show from: {todo.metadata.t}
	</span>
{/if}
