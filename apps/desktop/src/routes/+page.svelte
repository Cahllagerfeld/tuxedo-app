<script>
	import { Button } from "#lib/shared/ui/button/index.js";
	import { getAppState, getWorkspaceUi } from "#lib/app/app-context.js";
	import WorkspaceEmptyState from "#lib/modules/workspace/ui/WorkspaceEmptyState.svelte";

	const appState = getAppState();
	const ui = getWorkspaceUi();
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	{#if appState.workspace.recoveryError}
		<div role="alert" class="flex items-center gap-3 border-b p-3 text-sm">
			<span>{appState.workspace.recoveryError}</span>
			<Button
				variant="outline"
				size="sm"
				disabled={appState.workspace.isOperating}
				onclick={() => void appState.navigation.retry()}>Retry refresh</Button
			>
		</div>
	{/if}
	<WorkspaceEmptyState
		session={appState.session}
		warning={appState.navigation.destinationError}
		deleteWorkspace={appState.navigation.deleteWorkspace}
		disabled={appState.workspace.isOperating || appState.isLoading}
		openWorkspaceCreationDialog={ui.openWorkspaceCreationDialog}
	/>
</div>
