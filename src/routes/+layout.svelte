<script lang="ts">
	import { setAppState } from "@/app/app-context";
	import { AppState } from "@/app/app-state.svelte";
	import { setShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import AppNavbar from "@/app/AppNavbar.svelte";
	import ReaderStatusBar from "@/app/ReaderStatusBar.svelte";
	import WorkspaceSidebar from "@/modules/workspace/ui/sidebar/index.svelte";
	import WorkspaceCreationDialog from "@/modules/workspace/ui/WorkspaceCreationDialog.svelte";
	import * as Sidebar from "@/shared/ui/sidebar/index";
	import { Toaster } from "@/shared/ui/sonner";
	import { ModeWatcher } from "mode-watcher";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import "./layout.css";
	let { children } = $props();

	setShortcutScope();
	const appState = new AppState();
	setAppState(appState);

	onMount(() => {
		const stop = appState.workspace.observe(window.desktop, () => toast.info("Todo file reloaded"));
		void appState.workspace.initialize();
		return stop;
	});
</script>

<!-- app.html sets the initial theme; ModeWatcher follows system changes after mount. -->
<ModeWatcher defaultMode="system" disableHeadScriptInjection />
<Toaster position="top-center" />
<Sidebar.Provider
	class="flex h-dvh min-h-0 flex-col overflow-hidden bg-window-background font-normal antialiased"
	style="--window-toolbar-height: 2.5rem; --sidebar-width: 16rem;"
>
	<AppNavbar app={appState} />
	<div
		data-slot="app-inset"
		class="relative m-1 flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-background shadow-sm"
	>
		<WorkspaceSidebar
			bind:switcherOpen={appState.isWorkspaceSwitcherOpen}
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
		<main data-slot="app-content" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			{@render children()}
			<ReaderStatusBar
				activeWorkspace={appState.workspace.activeWorkspace}
				todoFile={appState.workspace.todoFile}
				todoSummary={appState.todos}
				pendingOperation={appState.workspace.pendingOperation}
			/>
		</main>
	</div>
	<WorkspaceCreationDialog
		bind:open={appState.isWorkspaceCreationDialogOpen}
		disabled={appState.workspace.isOperating || appState.workspace.isLoading}
		createWorkspace={appState.workspace.create}
	/>
</Sidebar.Provider>
