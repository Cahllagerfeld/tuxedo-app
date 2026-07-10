<script lang="ts">
	import { getAppState } from "$lib/app/app-context";
	import WorkspaceCreationDialog from "./WorkspaceCreationDialog.svelte";
	import WorkspaceSwitcher from "./WorkspaceSwitcher.svelte";

	const appState = getAppState();
	let creationDialog = $state<WorkspaceCreationDialog | null>(null);
</script>

<header class="h-12 bg-card border-b border-border flex items-center justify-between px-4">
	<div class="min-w-0">
		<WorkspaceSwitcher
			workspaces={appState.workspace.catalogue?.workspaces ?? []}
			activeWorkspaceId={appState.workspace.activeWorkspace?.id ?? null}
			selectWorkspace={appState.workspace.open}
			deleteWorkspace={appState.workspace.delete}
			openCreationDialog={() => {
				creationDialog?.openDialog();
			}}
		/>
	</div>
	<WorkspaceCreationDialog
		bind:this={creationDialog}
		showTrigger={false}
		createWorkspace={appState.workspace.create}
	/>
</header>
