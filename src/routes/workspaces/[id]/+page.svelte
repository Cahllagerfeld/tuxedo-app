<script lang="ts">
	import { page } from "$app/state";
	import { getAppContext } from "$lib/app/app-context";
	import WorkspaceContent from "$lib/modules/workspace/ui/WorkspaceContent.svelte";
	import WorkspaceHome from "$lib/modules/workspace/ui/WorkspaceHome.svelte";
	import { tick } from "svelte";
	const { app, navigation } = getAppContext();
	let recovery = $state<ReturnType<typeof WorkspaceHome>>();
	// Transfer owned DOM focus before an unreadable-file result removes the reader.
	$effect.pre(() => {
		if (
			!app.workspace.todoFile &&
			document.activeElement?.closest("[data-todo-reader], [data-todo-details]")
		) {
			void tick().then(() => recovery?.focusViewport());
		}
	});
</script>

{#if navigation.readerAvailable}
	{#key page.params.id}
		<WorkspaceContent
			bind:creationOpen={app.isTodoCreationOpen}
			bulkSelection={app.bulkSelection}
			workspace={app.workspace}
			todoFilter={app.todoFilter}
			filteredTodoItems={app.filteredTodoItems}
		/>
	{/key}
{:else}
	<WorkspaceHome
		bind:this={recovery}
		workspace={app.workspace}
		loading={navigation.busy}
		disabled={navigation.busy}
		unavailable={navigation.error ||
			app.workspace.error ||
			app.workspace.warning ||
			"This Workspace is unavailable."}
		openCreationDialog={app.openWorkspaceCreationDialog}
		showHome
		retry={navigation.retry}
	/>
{/if}
