<script lang="ts">
	import { setAppState } from "@/app/app-context";
	import { AppState } from "@/app/app-state.svelte";
	import AppNavbar from "@/app/AppNavbar.svelte";
	import ReaderStatusBar from "@/app/ReaderStatusBar.svelte";
	import WorkspaceSidebar from "@/modules/workspace/ui/sidebar/index.svelte";
	import WorkspaceCreationDialog from "@/modules/workspace/ui/WorkspaceCreationDialog.svelte";
	import * as Sidebar from "@/shared/ui/sidebar/index";
	import { Toaster } from "@/shared/ui/sonner";
	import { ModeWatcher } from "mode-watcher";
	import { onMount } from "svelte";
	import "./layout.css";
	let { children } = $props();

	const appState = new AppState();
	setAppState(appState);

	onMount(() => {
		void appState.workspace.initialize();
	});
</script>

<!-- app.html sets the initial theme; ModeWatcher follows system changes after mount. -->
<ModeWatcher defaultMode="system" disableHeadScriptInjection />
<Toaster position="top-center" />
<Sidebar.Provider
	class="flex h-dvh min-h-0 flex-col overflow-hidden bg-sidebar font-normal antialiased"
	style="--window-toolbar-height: 2.5rem; --sidebar-width: 14rem;"
>
	<AppNavbar />
	<div class="flex min-h-0 flex-1 overflow-hidden">
		<WorkspaceSidebar
			workspaces={appState.workspace.catalogue?.workspaces ?? []}
			activeWorkspaceId={appState.workspace.activeWorkspace?.id ?? null}
			todoSummary={appState.todos}
			todoFilter={appState.todoFilter}
			todoFileLoaded={appState.workspace.todoFile !== null}
			disabled={appState.workspace.isOperating || appState.workspace.isLoading}
			pendingOperation={appState.workspace.pendingOperation}
			selectWorkspace={appState.workspace.open}
			deleteWorkspace={appState.workspace.deleteWorkspace}
			openCreationDialog={appState.openWorkspaceCreationDialog}
		/>
		<Sidebar.Inset class="min-h-0 overflow-hidden border border-border shadow-sm">
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
	</div>
</Sidebar.Provider>
