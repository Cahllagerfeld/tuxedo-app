<script lang="ts">
	import TodoList from "$lib/modules/todo/ui/TodoList.svelte";
	import { getAppState } from "$lib/app/app-context";
	import * as Empty from "$lib/shared/ui/empty";

	const appState = getAppState();
</script>

{#if appState.workspace.error}
	<p role="alert">{appState.workspace.error}</p>
{/if}

{#if appState.workspace.activeWorkspace}
	<TodoList />
{:else if !appState.workspace.isLoading}
	<Empty.Root aria-label="No active workspace">
		<Empty.Header>
			<Empty.Title>No workspace open</Empty.Title>
			<Empty.Description
				>Open or create a Workspace to start working with a Todo file.</Empty.Description
			>
		</Empty.Header>
		{#if appState.workspace.warning}
			<p role="status">{appState.workspace.warning}</p>
		{/if}
	</Empty.Root>
{/if}
