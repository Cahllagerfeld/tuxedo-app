<script lang="ts">
	import type { TodoItem } from "$lib/modules/todo/domain/todo";
	import TodoList from "$lib/modules/todo/ui/TodoList.svelte";
	import { summarizeTodoFile } from "$lib/modules/todo/domain/todo-file-summary";
	import type { DesktopAPI } from "$lib/shared/desktop/contract";
	import { ElectronWorkspaceSessionState } from "./electron-workspace-session.svelte";
	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const session = new ElectronWorkspaceSessionState(desktop);
	let result = $state("");
	const summary = $derived(summarizeTodoFile(session.todoFile));
	async function remove(todo: TodoItem) {
		const outcome = await session.deleteTodo(todo);
		result = outcome.status === "applied" ? "Applied" : outcome.message;
	}
</script>

{#if session.todoFile}
	<TodoList
		todoFile={session.todoFile}
		disabled={session.isOperating}
		onDelete={remove}
		onToggleComplete={() => {}}
	/>
{/if}
<button
	disabled={session.isOperating}
	onclick={() => session.open("550e8400-e29b-41d4-a716-446655440000")}>Switch</button
>
<p aria-label="Total items">{summary.counts.total}</p>
<p aria-label="Open items">{summary.counts.open}</p>
<p aria-label="Completed items">{summary.counts.completed}</p>
<p aria-label="Projects">{summary.facets.projects.join(",")}</p>
<p aria-label="Action result">{result}</p>
<p aria-label="Pending operation">{session.pendingOperation ?? "none"}</p>
