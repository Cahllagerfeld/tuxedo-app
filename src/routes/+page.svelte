<script>
	import { getWorkspaceContext } from "$lib/app/app-context";
	import WorkspaceEmptyState from "$lib/modules/workspace/ui/WorkspaceEmptyState.svelte";
	const { workspace, navigation, openWorkspaceCreationDialog } = getWorkspaceContext();
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	<WorkspaceEmptyState
		session={workspace.session}
		warning={navigation.error}
		deleteWorkspace={workspace.deleteWorkspace}
		disabled={navigation.busy}
		{openWorkspaceCreationDialog}
		retry={navigation.retry}
	/>
</div>
