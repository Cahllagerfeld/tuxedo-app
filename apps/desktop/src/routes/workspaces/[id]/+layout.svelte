<script lang="ts">
	import { getAppState, getWorkspaceUi } from "#lib/app/app-context.js";
	import WorkspaceContent from "#lib/modules/workspace/ui/WorkspaceContent.svelte";
	import { Button } from "#lib/shared/ui/button/index.js";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { workspaceViewMode } from "#lib/app/workspace-paths.js";
	import WorkspaceLoading from "#lib/modules/workspace/ui/WorkspaceLoading.svelte";
	import type { LayoutProps } from "./$types";

	let { children }: LayoutProps = $props();
	const appState = getAppState();
	const ui = getWorkspaceUi();
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
				onclick={() => void appState.navigation.retry()}>Retry refresh</Button
			>
			<Button variant="outline" size="sm" href={resolve("/")}>Home</Button>
		</div>
	{/if}
	{#key page.params.id}
		{#if page.status >= 400}
			{@render children()}
		{:else if appState.showsDestination(page.params.id)}
			<WorkspaceContent
				bind:creationOpen={ui.isTodoCreationOpen}
				bulkSelection={ui.bulkSelection}
				{workspace}
				view={appState}
				deleteWorkspace={appState.navigation.deleteWorkspace}
				todoFilter={ui.todoFilter}
				filteredTodoItems={ui.filteredTodoItems}
				openWorkspaceCreationDialog={ui.openWorkspaceCreationDialog}
				viewMode={workspaceViewMode(page.route.id)}
			>
				{@render children()}
			</WorkspaceContent>
		{:else}
			<WorkspaceLoading />
		{/if}
	{/key}
</div>
