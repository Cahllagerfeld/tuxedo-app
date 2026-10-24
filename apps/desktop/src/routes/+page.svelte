<script>
	import { Button } from "#lib/shared/ui/button/index.js";
	import { getAppState } from "#lib/app/app-context.js";
	import WorkspaceEmptyState from "#lib/modules/workspace/ui/WorkspaceEmptyState.svelte";

	const appState = getAppState();
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	{#if appState.workspace.recoveryError}
		<div role="alert" class="flex items-center gap-3 border-b p-3 text-sm">
			<span>{appState.workspace.recoveryError}</span>
			<Button
				variant="outline"
				size="sm"
				disabled={appState.workspace.isOperating}
				onclick={() => void appState.workspace.retry()}>Retry refresh</Button
			>
		</div>
	{/if}
	<WorkspaceEmptyState
		session={appState.workspace.session}
		warning={appState.workspace.destinationError}
		deleteWorkspace={appState.workspace.deleteWorkspace}
		disabled={appState.workspace.isOperating || appState.workspace.isLoading}
		openWorkspaceCreationDialog={appState.openWorkspaceCreationDialog}
	/>
</div>
