<script lang="ts">
	import type { DesktopAPI } from "$lib/shared/desktop/contract";
	import { ElectronWorkspaceSessionState } from "$lib/modules/workspace/state/electron-workspace-session.svelte";
	import WorkspaceContent from "$lib/modules/workspace/ui/WorkspaceContent.svelte";
	import { AppState } from "./app-state.svelte";
	import AppShell from "./AppShell.svelte";
	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const appState = new AppState(new ElectronWorkspaceSessionState(desktop));
</script>

<AppShell {appState}>
	<WorkspaceContent
		workspace={appState.workspace}
		todoFilter={appState.todoFilter}
		filteredTodoItems={appState.filteredTodoItems}
		openWorkspaceCreationDialog={appState.openWorkspaceCreationDialog}
	/>
</AppShell>
