<script lang="ts">
	import { setShortcutScope } from "#lib/shared/shortcuts/shortcut-scope.svelte.js";
	import { SavedViewsResource, setSavedViews } from "../state/saved-views-resource.svelte";
	import { onMount, untrack } from "svelte";
	import type { DesktopAPI, TodoFileObservation } from "@tuxedo/contracts";
	import { toast } from "svelte-sonner";
	import { workspaceFixture } from "../state/testing/workspace-fixture.svelte";
	import { AppState } from "#lib/app/app-state.svelte.js";
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
	const app = new AppState(fixture.commands);
	// svelte-ignore state_referenced_locally
	const savedViews = new SavedViewsResource(desktop, app.workspace);
	setSavedViews(savedViews);
	const workspaceId = $derived(
		app.workspace.todoFile ? app.workspace.activeWorkspace?.id : undefined
	);
	$effect(() => {
		const id = workspaceId;
		if (id) void untrack(() => savedViews.load(id));
	});
	onMount(() => {
		const stop =
			observation && app.workspace.observe(observation, () => toast.info("Todo file reloaded"));
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
<p aria-label="Filter projects">{app.todoFilter.availableFacets.projects.join(",")}</p>
<Sidebar.Provider class="min-h-0 flex-col" style="--window-toolbar-height: 2.5rem;">
	{#if shell}
		<AppNavbar {app} />
	{/if}
	<div class="relative flex min-h-0">
		{#if shell}
			<WorkspaceSidebar
				bind:switcherOpen={app.isWorkspaceSwitcherOpen}
				workspaces={app.workspace.catalogue?.workspaces ?? []}
				activeWorkspaceId={app.workspace.activeWorkspace?.id ?? null}
				todoSummary={app.todos}
				todoFilter={app.todoFilter}
				todoFileLoaded={!!app.workspace.todoFile}
				disabled={app.workspace.isOperating || app.workspace.isLoading}
				selectWorkspace={fixture.navigate}
				deleteWorkspace={app.workspace.deleteWorkspace}
				openCreationDialog={app.openWorkspaceCreationDialog}
			/>
			<WorkspaceCreationDialog
				bind:open={app.isWorkspaceCreationDialogOpen}
				disabled={app.workspace.isOperating || app.workspace.isLoading}
				createWorkspace={app.workspace.create}
			/>
		{/if}
		<div class="flex h-96 min-w-0 flex-1 flex-col">
			<WorkspaceContent
				bulkSelection={app.bulkSelection}
				bind:creationOpen={app.isTodoCreationOpen}
				workspace={app.workspace}
				todoFilter={app.todoFilter}
				filteredTodoItems={app.filteredTodoItems}
				openWorkspaceCreationDialog={app.openWorkspaceCreationDialog}
			/>
		</div>
	</div>
</Sidebar.Provider>
<ReaderStatusBar
	activeWorkspace={app.workspace.activeWorkspace}
	todoFile={app.workspace.todoFile}
	todoSummary={app.todos}
	pendingOperation={app.workspace.pendingOperation}
/>
