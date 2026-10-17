<script lang="ts">
	import { getAppState } from "$lib/app/app-context";
	import WorkspaceContent from "$lib/modules/workspace/ui/WorkspaceContent.svelte";
	import WorkspaceUnavailable from "$lib/modules/workspace/ui/WorkspaceUnavailable.svelte";
	import type { PageProps } from "./$types";

	let { params }: PageProps = $props();
	const appState = getAppState();
	const workspace = appState.workspace;
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	{#if appState.shows(params.id)}
		<WorkspaceContent
			bind:creationOpen={appState.isTodoCreationOpen}
			bulkSelection={appState.bulkSelection}
			{workspace}
			todoFilter={appState.todoFilter}
			filteredTodoItems={appState.filteredTodoItems}
			openWorkspaceCreationDialog={appState.openWorkspaceCreationDialog}
		/>
	{:else}
		<WorkspaceUnavailable
			loading={workspace.isOperating || workspace.isLoading}
			message={appState.destinationError ||
				workspace.warning ||
				workspace.error ||
				"This Workspace is unavailable."}
			retry={() => appState.visitWorkspace(params.id)}
		/>
	{/if}
</div>
