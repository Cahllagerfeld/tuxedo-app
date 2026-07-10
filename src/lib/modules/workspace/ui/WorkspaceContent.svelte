<script lang="ts">
	import TodoList from "$lib/modules/todo/ui/TodoList.svelte";
	import { getAppState } from "$lib/app/app-context";

	const appState = getAppState();
</script>

{#if appState.workspace.error}
	<p role="alert">{appState.workspace.error}</p>
{:else if appState.workspace.activeWorkspace}
	<TodoList />
{:else if !appState.workspace.isLoading}
	<section aria-label="No active workspace">
		<h1>No workspace open</h1>
		<p>Open or create a Workspace to start working with a Todo file.</p>
		{#if appState.workspace.warning}
			<p role="status">{appState.workspace.warning}</p>
		{/if}
	</section>
{/if}
