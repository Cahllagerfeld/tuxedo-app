<script lang="ts">
	import { setShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import { onDestroy, onMount } from "svelte";
	import type { DesktopAPI, TodoFileObservation } from "$lib/shared/desktop/contract";
	import { toast } from "svelte-sonner";
	import { WorkspaceSessionFixture as WorkspaceCommands } from "../state/workspace-session-fixture.svelte";
	import { createReaderState } from "$lib/app/reader-state.svelte";
	import ReaderStatusBar from "$lib/app/ReaderStatusBar.svelte";
	import WorkspaceContent from "./WorkspaceContent.svelte";
	import AppNavbar from "$lib/app/AppNavbar.svelte";
	import WorkspaceSidebar from "./sidebar/index.svelte";
	import WorkspaceCreationDialog from "./WorkspaceCreationDialog.svelte";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import { Toaster } from "$lib/shared/ui/sonner";
	let {
		desktop,
		observation,
		shell = false,
	}: {
		desktop: DesktopAPI;
		observation?: TodoFileObservation;
		shell?: boolean;
	} = $props();
	setShortcutScope();
	// svelte-ignore state_referenced_locally
	const session: WorkspaceCommands = new WorkspaceCommands(desktop, () =>
		reader.todoFilter.reconcileSource()
	);
	const reader = createReaderState(session.data, session);
	let switcherOpen = $state(false);
	let creationDialogOpen = $state(false);
	const openWorkspaceCreationDialog = () => {
		creationDialogOpen = true;
	};
	onDestroy(() => session.destroy());
	onMount(() => {
		const stop =
			observation && session.observe(observation, () => toast.info("Todo file reloaded"));
		void session.initialize();
		return stop;
	});
</script>

<!-- Sonner only guards per-toast Infinity; an inherited Infinity becomes an immediate timer. -->
<Toaster duration={60_000} />
<p aria-label="Summary counts">
	{reader.todos.counts.open}/{reader.todos.counts.completed}
</p>
<p aria-label="Filter projects">{reader.todoFilter.availableFacets.projects.join(",")}</p>
<Sidebar.Provider class="min-h-0 flex-col" style="--window-toolbar-height: 2.5rem;">
	{#if shell}
		<AppNavbar
			workspace={session.data}
			commands={session}
			bulkSelectionActive={reader.bulkSelection.active}
			openWorkspaceSwitcher={() => {
				switcherOpen = true;
			}}
			{openWorkspaceCreationDialog}
			openTodoCreation={() => {
				reader.creationOpen = true;
			}}
		/>
	{/if}
	<div class="relative flex min-h-0">
		{#if shell}
			<WorkspaceSidebar
				bind:switcherOpen
				workspaces={session.catalogue?.workspaces ?? []}
				activeWorkspaceId={session.activeWorkspace?.id ?? null}
				todoSummary={reader.todos}
				todoFilter={reader.todoFilter}
				todoFileLoaded={!!session.todoFile}
				disabled={session.isOperating}
				selectWorkspace={session.open}
				deleteWorkspace={session.deleteWorkspace}
				openCreationDialog={openWorkspaceCreationDialog}
			/>
			<WorkspaceCreationDialog
				bind:open={creationDialogOpen}
				disabled={session.isOperating}
				createWorkspace={session.create}
			/>
		{/if}
		<div class="flex h-96 min-w-0 flex-1 flex-col">
			<WorkspaceContent
				bulkSelection={reader.bulkSelection}
				bind:creationOpen={reader.creationOpen}
				workspace={session.data}
				commands={session}
				todoFilter={reader.todoFilter}
				filteredTodoItems={reader.filteredTodoItems}
			/>
		</div>
	</div>
</Sidebar.Provider>
<ReaderStatusBar
	activeWorkspace={session.activeWorkspace}
	todoFile={session.todoFile}
	todoSummary={reader.todos}
	pendingOperation={session.pendingOperation}
/>
