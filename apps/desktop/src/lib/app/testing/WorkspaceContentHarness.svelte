<script lang="ts">
	import { setShortcutScope } from "#lib/shared/shortcuts/shortcut-scope.svelte.js";
	import { setSavedViews } from "#lib/modules/workspace/state/saved-views-resource.svelte.js";
	import { onMount } from "svelte";
	import type { DesktopAPI, TodoFileObservation } from "@tuxedo/contracts";
	import { toast } from "svelte-sonner";
	import { workspaceFixture } from "./workspace-fixture.svelte";
	import { WorkspaceUiState } from "#lib/modules/workspace/ui/workspace-ui-state.svelte.js";
	import ReaderStatusBar from "#lib/app/ReaderStatusBar.svelte";
	import WorkspaceContent from "#lib/modules/workspace/ui/WorkspaceContent.svelte";
	import AppNavbar from "#lib/app/AppNavbar.svelte";
	import WorkspaceSidebar from "#lib/modules/workspace/ui/sidebar/index.svelte";
	import WorkspaceRail from "#lib/modules/workspace/ui/WorkspaceRail.svelte";
	import WorkspaceCreationDialog from "#lib/modules/workspace/ui/WorkspaceCreationDialog.svelte";
	import type { WorkspaceViewMode } from "#lib/modules/workspace/domain/workspace.js";
	import * as Sidebar from "#lib/shared/ui/sidebar/index.js";
	import { Toaster } from "#lib/shared/ui/sonner/index.js";
	let {
		desktop,
		observation,
		shell = false,
		restoration = false,
		viewMode = "list",
	}: {
		desktop: DesktopAPI;
		observation?: TodoFileObservation;
		shell?: boolean;
		restoration?: boolean;
		viewMode?: WorkspaceViewMode;
	} = $props();
	setShortcutScope();
	// svelte-ignore state_referenced_locally
	const fixture = workspaceFixture(desktop);
	const app = fixture.createApp();
	const ui = new WorkspaceUiState(app, () => viewMode);
	setSavedViews(fixture.savedViews);
	onMount(() => {
		const stop =
			observation && fixture.observe(observation, () => toast.info("Todo file reloaded"));
		void fixture.start();
		return stop;
	});
</script>

<!-- Sonner only guards per-toast Infinity; an inherited Infinity becomes an immediate timer. -->
<Toaster duration={60_000} />
{#if restoration}
	<button disabled={app.workspace.isOperating} onclick={() => void fixture.reload()}
		>Restore Workspace session</button
	>
{/if}
<p aria-label="Summary counts">
	{app.todos.counts.open}/{app.todos.counts.completed}
</p>
<p aria-label="Filter projects">{ui.todoFilter.availableFacets.projects.join(",")}</p>
<Sidebar.Provider class="min-h-0 flex-col" style="--window-toolbar-height: 2.5rem;">
	{#if shell}
		<AppNavbar {app} {ui} />
	{/if}
	<div class="relative flex min-h-0">
		{#if shell}
			<WorkspaceRail
				bind:switcherOpen={ui.isWorkspaceSwitcherOpen}
				workspaces={app.catalogue?.workspaces ?? []}
				activeWorkspaceId={app.activeWorkspace?.id ?? null}
				{viewMode}
				listHref="/workspaces/test"
				kanbanHref="/workspaces/test/kanban"
				disabled={app.workspace.isOperating || app.isLoading}
				selectWorkspace={fixture.navigate}
				deleteWorkspace={app.navigation.deleteWorkspace}
				openCreationDialog={ui.openWorkspaceCreationDialog}
			/>
			<div class="relative flex min-h-0 shrink-0">
				<WorkspaceSidebar
					activeWorkspaceId={app.activeWorkspace?.id ?? null}
					todoSummary={app.todos}
					todoFilter={ui.todoFilter}
					todoFileLoaded={!!app.todoFile}
					disabled={app.workspace.isOperating || app.isLoading}
				/>
			</div>
			<WorkspaceCreationDialog
				bind:open={ui.isWorkspaceCreationDialogOpen}
				disabled={app.workspace.isOperating || app.isLoading}
				createWorkspace={app.navigation.create}
			/>
		{/if}
		<div class="flex h-96 min-w-0 flex-1 flex-col">
			<WorkspaceContent
				{viewMode}
				bulkSelection={ui.bulkSelection}
				bind:creationOpen={ui.isTodoCreationOpen}
				workspace={app.workspace}
				view={app}
				deleteWorkspace={app.navigation.deleteWorkspace}
				todoFilter={ui.todoFilter}
				filteredTodoItems={ui.filteredTodoItems}
				openWorkspaceCreationDialog={ui.openWorkspaceCreationDialog}
			/>
		</div>
	</div>
</Sidebar.Provider>
<ReaderStatusBar
	activeWorkspace={app.activeWorkspace}
	todoFile={app.todoFile}
	todoSummary={app.todos}
	pendingOperation={app.workspace.pendingOperation}
/>
