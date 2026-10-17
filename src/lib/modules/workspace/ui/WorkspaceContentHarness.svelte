<script lang="ts">
	import { setShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import { onMount } from "svelte";
	import type { DesktopAPI, TodoFileObservation } from "$lib/shared/desktop/contract";
	import { toast } from "svelte-sonner";
	import { WorkspaceSessionFixture as ElectronWorkspaceSessionState } from "../state/workspace-session-fixture.svelte";
	import { AppState } from "$lib/app/app-state.svelte";
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
		restoration = false,
	}: {
		desktop: DesktopAPI;
		observation?: TodoFileObservation;
		shell?: boolean;
		restoration?: boolean;
	} = $props();
	setShortcutScope();
	// svelte-ignore state_referenced_locally
	const session = new ElectronWorkspaceSessionState(desktop);
	const app = new AppState(session);
	onMount(() => {
		const stop =
			observation && app.workspace.observe(observation, () => toast.info("Todo file reloaded"));
		void session.initialize();
		return stop;
	});
</script>

<!-- Keep notices available in slow CI; Infinity overflows Sonner's browser timer. -->
<Toaster duration={60_000} />
{#if restoration}
	<button disabled={app.workspace.isOperating} onclick={() => void app.workspace.restore()}
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
			{#if app.workspace.todoFile}
				<WorkspaceContent
					bulkSelection={app.bulkSelection}
					bind:creationOpen={app.isTodoCreationOpen}
					workspace={app.workspace}
					todoFilter={app.todoFilter}
					filteredTodoItems={app.filteredTodoItems}
				/>
			{/if}
		</div>
	</div>
</Sidebar.Provider>
<ReaderStatusBar
	activeWorkspace={app.workspace.activeWorkspace}
	todoFile={app.workspace.todoFile}
	todoSummary={app.todos}
	pendingOperation={app.workspace.pendingOperation}
/>
