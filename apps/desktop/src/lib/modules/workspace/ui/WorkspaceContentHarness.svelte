<script lang="ts">
	import { setShortcutScope } from "#lib/shared/shortcuts/shortcut-scope.svelte.js";
	import { setSavedViews } from "../state/saved-views-resource.svelte";
	import { onMount } from "svelte";
	import type { DesktopAPI, TodoFileObservation } from "@tuxedo/contracts";
	import { toast } from "svelte-sonner";
	import { workspaceFixture } from "../state/testing/workspace-fixture.svelte";
	import { WorkspaceUiState } from "./workspace-ui-state.svelte";
	import ReaderStatusBar from "#lib/app/ReaderStatusBar.svelte";
	import WorkspaceContent from "./WorkspaceContent.svelte";
	import AppNavbar from "#lib/app/AppNavbar.svelte";
	import WorkspaceSidebar from "./sidebar/index.svelte";
	import WorkspaceCreationDialog from "./WorkspaceCreationDialog.svelte";
	import * as Sidebar from "#lib/shared/ui/sidebar/index.js";
	import { Toaster } from "#lib/shared/ui/sonner/index.js";
	let {
		desktop,
		observation,
		shell = false,
		restoration = false,
	}: {
		desktop: DesktopAPI;
		observation?: TodoFileObservation;
		shell?: boolean;
		restoration?: boolean;
	} = $props();
	setShortcutScope();
	// svelte-ignore state_referenced_locally
	const fixture = workspaceFixture(desktop);
	const app = fixture.createApp();
	const ui = new WorkspaceUiState(app);
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
			<WorkspaceSidebar
				bind:switcherOpen={ui.isWorkspaceSwitcherOpen}
				workspaces={app.catalogue?.workspaces ?? []}
				activeWorkspaceId={app.activeWorkspace?.id ?? null}
				todoSummary={app.todos}
				todoFilter={ui.todoFilter}
				todoFileLoaded={!!app.todoFile}
				disabled={app.workspace.isOperating || app.isLoading}
				selectWorkspace={fixture.navigate}
				deleteWorkspace={app.navigation.deleteWorkspace}
				openCreationDialog={ui.openWorkspaceCreationDialog}
			/>
			<WorkspaceCreationDialog
				bind:open={ui.isWorkspaceCreationDialogOpen}
				disabled={app.workspace.isOperating || app.isLoading}
				createWorkspace={app.navigation.create}
			/>
		{/if}
		<div class="flex h-96 min-w-0 flex-1 flex-col">
			<WorkspaceContent
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
