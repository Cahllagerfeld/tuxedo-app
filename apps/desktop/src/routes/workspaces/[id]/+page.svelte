<script lang="ts">
	import { getAppState } from "#lib/app/app-context.js";
	import WorkspaceContent from "#lib/modules/workspace/ui/WorkspaceContent.svelte";
	import { Button } from "#lib/shared/ui/button/index.js";
	import { resolve } from "$app/paths";
	import WorkspaceLoading from "#lib/modules/workspace/ui/WorkspaceLoading.svelte";
	import type { PageProps } from "./$types";

	let { params }: PageProps = $props();
	const appState = getAppState();
	const workspace = appState.workspace;
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	{#if workspace.recoveryError}
		<div role="alert" class="flex items-center gap-3 border-b p-3 text-sm">
			<span>{workspace.recoveryError}</span>
			<Button
				variant="outline"
				size="sm"
				disabled={workspace.isOperating}
				onclick={() => void workspace.retry()}>Retry refresh</Button
			>
			<Button variant="outline" size="sm" href={resolve("/")}>Home</Button>
		</div>
	{/if}
	{#key params.id}
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
	{/key}
</div>
