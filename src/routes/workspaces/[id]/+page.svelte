<script lang="ts">
	import { page } from "$app/state";
	import { getAppContext } from "$lib/app/app-context";
	import WorkspaceContent from "$lib/modules/workspace/ui/WorkspaceContent.svelte";
	import WorkspaceHome from "$lib/modules/workspace/ui/WorkspaceHome.svelte";
	const { app, navigation } = getAppContext();
</script>

{#if navigation.readerAvailable}
	{#key page.params.id}
		<WorkspaceContent
			bind:creationOpen={app.isTodoCreationOpen}
			bulkSelection={app.bulkSelection}
			workspace={app.workspace}
			todoFilter={app.todoFilter}
			filteredTodoItems={app.filteredTodoItems}
			openWorkspaceCreationDialog={app.openWorkspaceCreationDialog}
		/>
	{/key}
{:else}
	<WorkspaceHome
		workspace={app.workspace}
		loading={navigation.busy}
		disabled={navigation.busy}
		unavailable={navigation.error ||
			app.workspace.error ||
			app.workspace.warning ||
			"This Workspace is unavailable."}
		openWorkspace={navigation.openWorkspace}
		openCreationDialog={app.openWorkspaceCreationDialog}
		retry={navigation.retry}
		goHome={navigation.goHome}
	/>
{/if}
