<script lang="ts">
	import {
		SavedViewsResource,
		setSavedViews,
	} from "$lib/modules/workspace/state/saved-views-resource.svelte";
	import { savedViewsDependency } from "$lib/modules/workspace/state/saved-views";
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
	import { workspaceRouting } from "$lib/app/workspace-routing.svelte";
	import { goto, invalidate } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page, navigating } from "$app/state";
	import "./layout.css";
	let { children } = $props();

	setShortcutScope();
	const appState = new AppState(workspaceRouting());
	setAppState(appState);
	setSavedViews(
		new SavedViewsResource(
			window.desktop,
			appState.workspace,
			() => page.data.savedViews,
			(workspaceId) => invalidate(savedViewsDependency(workspaceId))
		)
	);
	const busy = $derived(
		appState.workspace.isOperating || appState.workspace.isLoading || !!navigating.to
	);
	const showsActiveWorkspace = $derived(appState.showsDestination(page.params.id));
	const openWorkspace = (id: string, replaceState = false) =>
		goto(resolve("/workspaces/[id]", { id }), { replaceState });
</script>

<!-- app.html sets the initial theme; ModeWatcher follows system changes after mount. -->
<ModeWatcher defaultMode="system" disableHeadScriptInjection />
<Toaster position="top-center" />
<Sidebar.Provider
	class="flex h-dvh min-h-0 flex-col overflow-hidden bg-window-background font-normal antialiased"
	style="--window-toolbar-height: 2.5rem; --sidebar-width: 16rem;"
>
	{#if appState.workspace.isStarting}
		<p role="status" class="sr-only">Loading Tuxedo…</p>
	{:else}
		<AppNavbar
			app={appState}
			readerShown={showsActiveWorkspace}
			workspaceShown={!!page.params.id}
		/>
		<div
			data-slot="app-inset"
			class="relative m-1 flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-background shadow-sm"
		>
			{#if page.params.id}
				<WorkspaceSidebar
					bind:switcherOpen={appState.isWorkspaceSwitcherOpen}
					workspaces={appState.workspace.catalogue?.workspaces ?? []}
					activeWorkspaceId={appState.workspace.activeWorkspace?.id ?? null}
					todoSummary={appState.todos}
					todoFilter={appState.todoFilter}
					todoFileLoaded={showsActiveWorkspace && appState.workspace.todoFile !== null}
					disabled={busy}
					pendingOperation={appState.workspace.pendingOperation}
					selectWorkspace={(id) => void openWorkspace(id)}
					deleteWorkspace={appState.workspace.deleteWorkspace}
					openCreationDialog={appState.openWorkspaceCreationDialog}
				/>
			{/if}
			<main data-slot="app-content" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				{@render children()}
				{#if showsActiveWorkspace}
					<ReaderStatusBar
						activeWorkspace={appState.workspace.activeWorkspace}
						todoFile={appState.workspace.todoFile}
						todoSummary={appState.todos}
						pendingOperation={appState.workspace.pendingOperation}
					/>
				{/if}
			</main>
		</div>
	{/if}
	<WorkspaceCreationDialog
		bind:open={appState.isWorkspaceCreationDialogOpen}
		disabled={busy}
		createWorkspace={appState.workspace.create}
	/>
</Sidebar.Provider>
