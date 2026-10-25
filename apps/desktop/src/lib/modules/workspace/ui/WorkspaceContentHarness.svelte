<script lang="ts">
	import { setShortcutScope } from "#lib/shared/shortcuts/shortcut-scope.svelte.js";
	import { setSavedViews } from "../state/saved-views-resource.svelte";
	import { panelRouting, setPanelRouting, type PanelHistory } from "./todo-panel-routing.svelte.js";
	import { onMount, tick } from "svelte";
	import type { DesktopAPI, TodoFileObservation } from "@tuxedo/contracts";
	import { toast } from "svelte-sonner";
	import { workspaceFixture } from "../state/testing/workspace-fixture.svelte";
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
		panelHistory,
		panelLocation = false,
	}: {
		desktop: DesktopAPI;
		observation?: TodoFileObservation;
		shell?: boolean;
		restoration?: boolean;
		panelHistory?: PanelHistory;
		panelLocation?: boolean;
	} = $props();
	setShortcutScope();
	// svelte-ignore state_referenced_locally
	const fixture = workspaceFixture(desktop);
	const app = fixture.createApp();
	setSavedViews(fixture.savedViews);
	let entry = $state.raw({
		url: new URL("https://tuxedo.test/workspaces/work"),
		state: {} as App.PageState,
	});
	const memoryHistory: PanelHistory = {
		url: () => entry.url,
		state: () => entry.state,
		update: async (url, state) => {
			await tick();
			if (!app.workspace.isOperating) entry = { url, state };
		},
	};
	// svelte-ignore state_referenced_locally
	setPanelRouting(panelRouting(panelHistory ?? memoryHistory, () => app.workspace.isOperating));
	onMount(() => {
		const stop =
			observation && fixture.observe(observation, () => toast.info("Todo file reloaded"));
		void fixture.start();
		return stop;
	});
</script>

{#if panelLocation}
	<output aria-label="Panel URL">{entry.url.href}</output>
{/if}
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
				workspaces={app.catalogue?.workspaces ?? []}
				activeWorkspaceId={app.activeWorkspace?.id ?? null}
				todoSummary={app.todos}
				todoFilter={app.todoFilter}
				todoFileLoaded={!!app.todoFile}
				disabled={app.workspace.isOperating || app.isLoading}
				selectWorkspace={fixture.navigate}
				deleteWorkspace={app.navigation.deleteWorkspace}
				openCreationDialog={app.openWorkspaceCreationDialog}
			/>
			<WorkspaceCreationDialog
				bind:open={app.isWorkspaceCreationDialogOpen}
				disabled={app.workspace.isOperating || app.isLoading}
				createWorkspace={app.navigation.create}
			/>
		{/if}
		<div class="flex h-96 min-w-0 flex-1 flex-col">
			<WorkspaceContent
				bulkSelection={app.bulkSelection}
				bind:creationOpen={app.isTodoCreationOpen}
				workspace={app.workspace}
				view={app}
				deleteWorkspace={app.navigation.deleteWorkspace}
				todoFilter={app.todoFilter}
				filteredTodoItems={app.filteredTodoItems}
				openWorkspaceCreationDialog={app.openWorkspaceCreationDialog}
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
