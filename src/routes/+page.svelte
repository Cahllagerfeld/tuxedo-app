<script>
	import { getAppState } from "$lib/app/app-context";
	import WorkspaceContent from "$lib/modules/workspace/ui/WorkspaceContent.svelte";

	const appState = getAppState();
</script>

<div class="flex min-h-full w-full p-4">
	<WorkspaceContent
		workspace={appState.workspace}
		openWorkspaceCreationDialog={appState.openWorkspaceCreationDialog}
	/>
</div>
