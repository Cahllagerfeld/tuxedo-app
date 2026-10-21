<script>
	import { getAppState } from "$lib/app/app-context";
	import WorkspaceEmptyState from "$lib/modules/workspace/ui/WorkspaceEmptyState.svelte";

	const appState = getAppState();
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	<WorkspaceEmptyState
		session={appState.workspace.session}
		warning={appState.destinationError}
		deleteWorkspace={appState.workspace.deleteWorkspace}
		disabled={appState.workspace.isOperating || appState.workspace.isLoading}
		openWorkspaceCreationDialog={appState.openWorkspaceCreationDialog}
	/>
</div>
