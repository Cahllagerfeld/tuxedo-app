<script lang="ts">
	import { setWorkspaceContext } from "@/app/app-context";
	import { createReaderState } from "@/app/reader-state.svelte";
	import { setShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import AppNavbar from "@/app/AppNavbar.svelte";
	import ReaderStatusBar from "@/app/ReaderStatusBar.svelte";
	import WorkspaceSidebar from "@/modules/workspace/ui/sidebar/index.svelte";
	import WorkspaceCreationDialog from "@/modules/workspace/ui/WorkspaceCreationDialog.svelte";
	import * as Sidebar from "@/shared/ui/sidebar/index";
	import { Toaster } from "@/shared/ui/sonner";
	import { ModeWatcher } from "mode-watcher";
	import { navigating, page } from "$app/state";
	import { afterNavigate, invalidate } from "$app/navigation";
	import { WorkspaceCommands } from "$lib/modules/workspace/state/workspace-commands.svelte";
	import { sessionDependency, viewsDependency } from "$lib/modules/workspace/state/workspace-load";
	import { createWorkspaceNavigation } from "@/app/workspace-navigation.svelte";
	import type { LayoutProps } from "./$types";
	import "./layout.css";
	let { data, children }: LayoutProps = $props();

	setShortcutScope();
	const workspace: WorkspaceCommands = new WorkspaceCommands(
		window.desktop,
		() => ({ ...data.sessionData, ...data.viewsData }),
		async (dependency) => {
			await invalidate(
				(url) =>
					(dependency !== "views" && url.href === sessionDependency) ||
					(dependency !== "session" && url.href === viewsDependency)
			);
			reader.todoFilter.reconcileSource();
		},
		() => !!navigating.to
	);
	const reader = createReaderState(workspace);
	afterNavigate((event) => {
		if (event.from?.params?.id !== event.to?.params?.id)
			void event.complete.then(() => {
				reader.creationOpen = false;
				reader.bulkSelection.exit();
			});
	});
	const navigation = createWorkspaceNavigation(
		workspace,
		() => data.destination,
		() => data.destinationError
	);
	let creationDialogOpen = $state(false);
	let switcherOpen = $state(false);
	const openWorkspaceCreationDialog = () => {
		creationDialogOpen = true;
	};
	setWorkspaceContext({ workspace, reader, navigation, openWorkspaceCreationDialog });
</script>

<!-- app.html sets the initial theme; ModeWatcher follows system changes after mount. -->
<ModeWatcher defaultMode="system" disableHeadScriptInjection />
<Toaster position="top-center" />
<Sidebar.Provider
	class="flex h-dvh min-h-0 flex-col overflow-hidden bg-window-background font-normal antialiased"
	style="--window-toolbar-height: 2.5rem; --sidebar-width: 16rem;"
	data-sveltekit-preload-data={navigation.busy ? "off" : "hover"}
>
	<AppNavbar
		{workspace}
		bulkSelectionActive={reader.bulkSelection.active}
		readerShown={navigation.readerAvailable}
		workspaceShown={!!page.params.id}
		openWorkspaceSwitcher={() => {
			switcherOpen = true;
		}}
		{openWorkspaceCreationDialog}
		openTodoCreation={() => {
			reader.creationOpen = true;
		}}
	/>
	<div
		data-slot="app-inset"
		class="relative m-1 flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-background shadow-sm"
	>
		{#if page.params.id}
			<WorkspaceSidebar
				bind:switcherOpen
				workspaces={workspace.catalogue?.workspaces ?? []}
				activeWorkspaceId={workspace.activeWorkspace?.id ?? null}
				todoSummary={reader.todos}
				todoFilter={reader.todoFilter}
				todoFileLoaded={navigation.readerAvailable}
				disabled={navigation.busy}
				pendingOperation={workspace.pendingOperation}
				selectWorkspace={(id) => navigation.selectWorkspace(id)}
				deleteWorkspace={workspace.deleteWorkspace}
				openCreationDialog={openWorkspaceCreationDialog}
			/>
		{/if}
		<main data-slot="app-content" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			{@render children()}
			{#if navigation.readerAvailable}
				<ReaderStatusBar
					activeWorkspace={workspace.activeWorkspace}
					todoFile={workspace.todoFile}
					todoSummary={reader.todos}
					pendingOperation={workspace.pendingOperation}
				/>
			{/if}
		</main>
	</div>
	<WorkspaceCreationDialog
		bind:open={creationDialogOpen}
		disabled={navigation.busy}
		createWorkspace={navigation.createWorkspace}
	/>
</Sidebar.Provider>
