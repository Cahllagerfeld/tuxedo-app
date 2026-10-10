<script lang="ts">
	import type { AppState } from "@/app/app-state.svelte";
	import type { Snippet } from "svelte";
	import AppNavbar from "@/app/AppNavbar.svelte";
	import AppShortcuts from "@/app/AppShortcuts.svelte";
	import ReaderStatusBar from "@/app/ReaderStatusBar.svelte";
	import WorkspaceSidebar from "@/modules/workspace/ui/sidebar/index.svelte";
	import WorkspaceCreationDialog from "@/modules/workspace/ui/WorkspaceCreationDialog.svelte";
	import * as Sidebar from "@/shared/ui/sidebar/index";
	import { Toaster } from "@/shared/ui/sonner";
	import { ModeWatcher } from "mode-watcher";
	import { onMount, tick } from "svelte";

	let { children, appState }: { children: Snippet; appState: AppState } = $props();

	let switcherTrigger = $state<HTMLButtonElement | null>(null);
	let sidebarOpen = $state(true);
	let creationTrigger: HTMLElement | null = null;
	function openCreation() {
		appState.openWorkspaceCreationDialog();
	}

	onMount(() => {
		void appState.workspace.initialize();
	});
</script>

<!-- The SPA initializes on mount; runtime inline scripts are blocked by Electron's CSP. -->
<ModeWatcher defaultMode="system" disableHeadScriptInjection />
<Toaster position="top-center" />
<Sidebar.Provider
	bind:open={sidebarOpen}
	class="flex h-dvh min-h-0 flex-col overflow-hidden bg-sidebar font-normal antialiased"
	style="--window-toolbar-height: 2.5rem; --sidebar-width: 14rem;"
>
	<AppNavbar>
		<AppShortcuts
			disabled={appState.workspace.isOperating || appState.workspace.isLoading}
			openSwitcher={async () => {
				sidebarOpen = true;
				await tick();
				switcherTrigger?.click();
			}}
			{openCreation}
		/>
	</AppNavbar>
	<div class="flex min-h-0 flex-1 overflow-hidden">
		<WorkspaceSidebar
			bind:switcherTrigger
			workspaces={appState.workspace.catalogue?.workspaces ?? []}
			activeWorkspaceId={appState.workspace.activeWorkspace?.id ?? null}
			todoSummary={appState.todos}
			todoFilter={appState.todoFilter}
			todoFileLoaded={appState.workspace.todoFile !== null}
			disabled={appState.workspace.isOperating || appState.workspace.isLoading}
			pendingOperation={appState.workspace.pendingOperation}
			selectWorkspace={appState.workspace.open}
			deleteWorkspace={appState.workspace.deleteWorkspace}
			openCreationDialog={openCreation}
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
			onOpenAutoFocus={() => {
				creationTrigger =
					document.activeElement instanceof HTMLElement ? document.activeElement : null;
			}}
			onCloseAutoFocus={(event) => {
				event.preventDefault();
				(creationTrigger?.isConnected ? creationTrigger : switcherTrigger)?.focus();
			}}
			bind:open={appState.isWorkspaceCreationDialogOpen}
			disabled={appState.workspace.isOperating || appState.workspace.isLoading}
			createWorkspace={appState.workspace.create}
		/>
	</div>
</Sidebar.Provider>
