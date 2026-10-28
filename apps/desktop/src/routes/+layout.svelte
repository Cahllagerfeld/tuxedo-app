<script lang="ts">
	import { setSavedViews } from "#lib/modules/workspace/state/saved-views-resource.svelte.js";
	import { setAppState, setWorkspaceUi } from "#lib/app/app-context.js";
	import { AppState } from "#lib/app/app-state.svelte.js";
	import { WorkspaceUiState } from "#lib/modules/workspace/ui/workspace-ui-state.svelte.js";
	import { setShortcutScope } from "#lib/shared/shortcuts/shortcut-scope.svelte.js";
	import AppNavbar from "#lib/app/AppNavbar.svelte";
	import ReaderStatusBar from "#lib/app/ReaderStatusBar.svelte";
	import WorkspaceSidebar from "#lib/modules/workspace/ui/sidebar/index.svelte";
	import WorkspaceRail from "#lib/modules/workspace/ui/WorkspaceRail.svelte";
	import WorkspaceCreationDialog from "#lib/modules/workspace/ui/WorkspaceCreationDialog.svelte";
	import * as Sidebar from "#lib/shared/ui/sidebar/index.js";
	import { Toaster } from "#lib/shared/ui/sonner/index.js";
	import { ModeWatcher } from "mode-watcher";
	import { workspaceRouting } from "#lib/app/workspace-routing.svelte.js";
	import { workspacePath, workspaceViewMode } from "#lib/app/workspace-paths.js";
	import { goto } from "$app/navigation";
	import { page, navigating } from "$app/state";
	import "./layout.css";
	let { children } = $props();

	setShortcutScope();
	const { workspace, savedViews, routes, navigation } = workspaceRouting();
	const appState = new AppState(workspace, routes, navigation);
	const ui = new WorkspaceUiState(appState, () => workspaceViewMode(page.route.id));
	setAppState(appState);
	setWorkspaceUi(ui);
	setSavedViews(savedViews);
	const busy = $derived(appState.workspace.isOperating || appState.isLoading || !!navigating.to);
	const showsActiveWorkspace = $derived(appState.showsDestination(page.params.id));
	const viewMode = $derived(workspaceViewMode(page.route.id));
	const openWorkspace = (id: string, replace = false) =>
		goto(workspacePath(id, viewMode), { replace });
</script>

<!-- app.html sets the initial theme; ModeWatcher follows system changes after mount. -->
<ModeWatcher defaultMode="system" disableHeadScriptInjection />
<Toaster position="top-center" />
<Sidebar.Provider
	class="flex h-dvh min-h-0 flex-col overflow-hidden bg-window-background font-normal antialiased"
	style="--window-toolbar-height: 2.5rem; --sidebar-width: 16rem;"
>
	{#if appState.navigation.isStarting}
		<p role="status" class="sr-only">Loading Tuxedo…</p>
	{:else}
		<AppNavbar
			app={appState}
			{ui}
			readerShown={showsActiveWorkspace}
			workspaceShown={!!page.params.id}
		/>
		<div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
			{#if page.params.id}
				<WorkspaceRail
					bind:switcherOpen={ui.isWorkspaceSwitcherOpen}
					workspaces={appState.catalogue?.workspaces ?? []}
					activeWorkspaceId={appState.activeWorkspace?.id ?? null}
					{viewMode}
					listHref={workspacePath(page.params.id, "list")}
					kanbanHref={workspacePath(page.params.id, "kanban")}
					disabled={busy}
					pendingOperation={appState.workspace.pendingOperation}
					selectWorkspace={(id) => void openWorkspace(id)}
					deleteWorkspace={appState.navigation.deleteWorkspace}
					openCreationDialog={ui.openWorkspaceCreationDialog}
				/>
			{/if}
			<div
				data-slot="app-inset"
				class="relative m-1 flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background shadow-sm"
			>
				{#if page.params.id}
					<div class="relative flex min-h-0 shrink-0">
						<WorkspaceSidebar
							activeWorkspaceId={appState.activeWorkspace?.id ?? null}
							todoSummary={appState.todos}
							todoFilter={ui.todoFilter}
							todoFileLoaded={showsActiveWorkspace && appState.todoFile !== null}
							disabled={busy}
						/>
					</div>
				{/if}
				<main data-slot="app-content" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
					{@render children()}
					{#if showsActiveWorkspace}
						<ReaderStatusBar
							activeWorkspace={appState.activeWorkspace}
							todoFile={appState.todoFile}
							todoSummary={appState.todos}
							pendingOperation={appState.workspace.pendingOperation}
						/>
					{/if}
				</main>
			</div>
		</div>
	{/if}
	<WorkspaceCreationDialog
		bind:open={ui.isWorkspaceCreationDialogOpen}
		disabled={busy}
		createWorkspace={appState.navigation.create}
	/>
</Sidebar.Provider>
