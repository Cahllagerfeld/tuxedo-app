<script lang="ts">
	import { onMount } from "svelte";
	import type { TodoItem } from "#lib/modules/todo/domain/todo.js";
	import TodoList from "#lib/modules/todo/ui/TodoList.svelte";
	import { ScrollArea } from "#lib/shared/ui/scroll-area/index.js";
	import "../../../../routes/layout.css";
	import { summarizeTodoFile } from "#lib/modules/todo/domain/todo-file-summary.js";
	import { summarizeTodoFilterFacets } from "#lib/modules/todo/domain/todo-filter-facets.js";
	import type { DesktopAPI } from "@tuxedo/contracts";
	import { workspaceRouteFixture } from "./testing/workspace-route-fixture.svelte";
	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const fixture = workspaceRouteFixture(desktop);
	const session = fixture.commands;
	onMount(() => {
		void fixture.start();
	});
	let result = $state("");
	let viewport = $state<HTMLElement | null>(null);
	const summary = $derived(summarizeTodoFile(session.todoFile));
	async function remove(todo: TodoItem) {
		const outcome = await session.deleteTodo(todo);
		result = outcome.status === "applied" ? "Applied" : outcome.message;
	}
	async function toggleComplete(todo: TodoItem) {
		const outcome = await session.setCompletion(todo);
		result = outcome.status === "applied" ? "Applied" : outcome.message;
	}
</script>

{#if session.todoFile}
	<ScrollArea bind:viewportRef={viewport} class="h-96">
		<TodoList
			scrollElement={viewport}
			todoFile={session.todoFile}
			disabled={session.isOperating}
			onDelete={remove}
			onToggleComplete={toggleComplete}
		/>
	</ScrollArea>
{/if}
<button disabled={session.isOperating} onclick={() => fixture.reload()}>Restore</button>
<button
	disabled={session.isOperating}
	onclick={() => fixture.navigate("550e8400-e29b-41d4-a716-446655440000")}>Switch</button
>
<p aria-label="Total items">{summary.counts.total}</p>
<p aria-label="Open count">{summary.counts.open}</p>
<p aria-label="Open items">{summary.counts.open}</p>
<p aria-label="Completed items">{summary.counts.completed}</p>
<p aria-label="Projects">{summarizeTodoFilterFacets(summary.items, null).projects.join(",")}</p>
<p aria-label="Action result">{result}</p>
<p aria-label="Pending operation">{session.pendingOperation ?? "none"}</p>
<p aria-label="Pending target">
	{session.pendingTarget ? JSON.stringify(session.pendingTarget) : "none"}
</p>
