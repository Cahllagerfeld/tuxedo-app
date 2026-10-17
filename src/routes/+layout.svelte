<script lang="ts">
	import { setAppContext } from "@/app/app-context";
	import { AppState } from "@/app/app-state.svelte";
	import { setShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import AppNavbar from "@/app/AppNavbar.svelte";
	import ReaderStatusBar from "@/app/ReaderStatusBar.svelte";
	import WorkspaceSidebar from "@/modules/workspace/ui/sidebar/index.svelte";
	import WorkspaceCreationDialog from "@/modules/workspace/ui/WorkspaceCreationDialog.svelte";
	import * as Sidebar from "@/shared/ui/sidebar/index";
	import { Toaster } from "@/shared/ui/sonner";
	import { ModeWatcher } from "mode-watcher";
	import { page } from "$app/state";
	import { invalidate } from "$app/navigation";
	import { ElectronWorkspaceSessionState } from "$lib/modules/workspace/state/electron-workspace-session.svelte";
	import {
		sessionDependency,
		workspaceDependency,
		viewsDependency,
	} from "$lib/modules/workspace/state/workspace-load";
	import { createWorkspaceNavigation } from "@/app/workspace-navigation.svelte";
	import "./layout.css";
	let { children } = $props();

	setShortcutScope();
	const appState = new AppState(
		new ElectronWorkspaceSessionState(
			window.desktop,
			() => ({ ...page.data.sessionData, ...page.data.viewsData }),
			(dependency) =>
				invalidate(
					(url) =>
						(dependency !== "views" &&
							(url.href === sessionDependency || url.href === workspaceDependency)) ||
						(dependency !== "session" && url.href === viewsDependency)
				)
		)
	);
	const navigation = createWorkspaceNavigation(appState);
	setAppContext({ app: appState, navigation });
</script>

<!-- app.html sets the initial theme; ModeWatcher follows system changes after mount. -->
<ModeWatcher defaultMode="system" disableHeadScriptInjection />
<Toaster position="top-center" />
<Sidebar.Provider
	class="flex h-dvh min-h-0 flex-col overflow-hidden bg-window-background font-normal antialiased"
	style="--window-toolbar-height: 2.5rem; --sidebar-width: 16rem;"
>
	<AppNavbar
		app={appState}
		readerAvailable={navigation.readerAvailable}
		navigationBusy={navigation.busy}
	/>
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
			todoFileLoaded={navigation.readerAvailable}
			disabled={navigation.busy}
			pendingOperation={appState.workspace.pendingOperation}
			deleteWorkspace={appState.workspace.deleteWorkspace}
			openCreationDialog={appState.openWorkspaceCreationDialog}
		/>
		<main data-slot="app-content" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			{@render children()}
			{#if navigation.readerAvailable}<ReaderStatusBar
					activeWorkspace={appState.workspace.activeWorkspace}
					todoFile={appState.workspace.todoFile}
					todoSummary={appState.todos}
					pendingOperation={appState.workspace.pendingOperation}
				/>{/if}
		</main>
	</div>
	<WorkspaceCreationDialog
		bind:open={appState.isWorkspaceCreationDialogOpen}
		disabled={navigation.busy}
		createWorkspace={navigation.createWorkspace}
	/>
</Sidebar.Provider>
