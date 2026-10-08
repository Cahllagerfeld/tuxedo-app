<script>
	import { getAppState } from "$lib/app/app-context";
	import WorkspaceContent from "$lib/modules/workspace/ui/WorkspaceContent.svelte";

	const appState = getAppState();
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	<WorkspaceContent
		workspace={appState.workspace}
		openWorkspaceCreationDialog={appState.openWorkspaceCreationDialog}
	/>
</div>
