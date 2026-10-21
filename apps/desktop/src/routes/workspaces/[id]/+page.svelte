<script lang="ts">
	import { getAppState } from "$lib/app/app-context";
	import WorkspaceContent from "$lib/modules/workspace/ui/WorkspaceContent.svelte";
	import WorkspaceLoading from "$lib/modules/workspace/ui/WorkspaceLoading.svelte";
	import { navigating } from "$app/state";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import type { PageProps } from "./$types";

	let { params }: PageProps = $props();
	const appState = getAppState();
	const workspace = appState.workspace;

	// Navigation is external to Svelte state: failed or lost destinations recover through Home.
	$effect(() => {
		if (
			!navigating.to &&
			!workspace.isOperating &&
			!workspace.isLoading &&
			!appState.showsDestination(params.id)
		) {
			void goto(resolve("/"), { replaceState: true });
		}
	});
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	{#if appState.showsDestination(params.id)}
		<WorkspaceContent
			bind:creationOpen={appState.isTodoCreationOpen}
			bulkSelection={appState.bulkSelection}
			{workspace}
			todoFilter={appState.todoFilter}
			filteredTodoItems={appState.filteredTodoItems}
			openWorkspaceCreationDialog={appState.openWorkspaceCreationDialog}
		/>
	{:else}
		<WorkspaceLoading />
	{/if}
</div>
