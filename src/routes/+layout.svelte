<script lang="ts">
	import { setAppState } from "@/app/app-context";
	import { AppState } from "@/app/app-state.svelte";
	import AppHeader from "@/app/AppHeader.svelte";
	import ReaderStatusBar from "@/app/ReaderStatusBar.svelte";
	import WorkspaceSidebar from "@/modules/workspace/ui/sidebar/index.svelte";
	import WorkspaceCreationDialog from "@/modules/workspace/ui/WorkspaceCreationDialog.svelte";
	import * as Sidebar from "@/shared/ui/sidebar/index";
	import { Toaster } from "@/shared/ui/sonner";
	import { onMount } from "svelte";
	import "./layout.css";
	let { children } = $props();

	const appState = new AppState();
	setAppState(appState);

	onMount(() => {
		void appState.workspace.initialize();
	});
</script>

<Toaster position="top-center" />
<Sidebar.Provider
	class="h-dvh min-h-0 overflow-hidden font-normal antialiased"
	style="--sidebar-width: 14rem;"
>
	<WorkspaceSidebar
		workspaces={appState.workspace.catalogue?.workspaces ?? []}
		activeWorkspaceId={appState.workspace.activeWorkspace?.id ?? null}
		todoSummary={appState.todos}
		disabled={appState.workspace.isOperating || appState.workspace.isLoading}
		pendingOperation={appState.workspace.pendingOperation}
		selectWorkspace={appState.workspace.open}
		deleteWorkspace={appState.workspace.deleteWorkspace}
		openCreationDialog={appState.openWorkspaceCreationDialog}
	/>
	<Sidebar.Inset class="min-h-0 overflow-hidden border border-border shadow-sm">
		<AppHeader activeWorkspace={appState.workspace.activeWorkspace} />
		{@render children()}
		<ReaderStatusBar
			activeWorkspace={appState.workspace.activeWorkspace}
			todoFile={appState.workspace.todoFile}
			todoSummary={appState.todos}
			pendingOperation={appState.workspace.pendingOperation}
		/>
	</Sidebar.Inset>
	<WorkspaceCreationDialog
		bind:open={appState.isWorkspaceCreationDialogOpen}
		disabled={appState.workspace.isOperating || appState.workspace.isLoading}
		createWorkspace={appState.workspace.create}
	/>
</Sidebar.Provider>
