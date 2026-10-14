<script>
	import { dev } from "$app/environment";
	import { page } from "$app/state";
	import TodoDetailPrototype from "$lib/modules/todo/ui/TodoDetailPrototype.svelte";
	import { getAppState } from "$lib/app/app-context";
	import WorkspaceContent from "$lib/modules/workspace/ui/WorkspaceContent.svelte";

	const appState = getAppState();
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	{#if dev && page.url.searchParams.get("prototype") === "todo-detail"}
		<TodoDetailPrototype />
	{:else}
		<WorkspaceContent
			bind:creationOpen={appState.isTodoCreationOpen}
			workspace={appState.workspace}
			todoFilter={appState.todoFilter}
			filteredTodoItems={appState.filteredTodoItems}
			openWorkspaceCreationDialog={appState.openWorkspaceCreationDialog}
		/>
	{/if}
</div>
