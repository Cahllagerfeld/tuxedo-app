<script lang="ts">
	import type { Snippet } from "svelte";
	import { getWorkspaceContext } from "./app-context";
	import AppNavbar from "./AppNavbar.svelte";
	import ReaderStatusBar from "./ReaderStatusBar.svelte";
	import WorkspaceSidebar from "$lib/modules/workspace/ui/sidebar/index.svelte";
	let {
		children,
		workspaceShown = false,
		readerShown = false,
	}: {
		children: Snippet;
		workspaceShown?: boolean;
		readerShown?: boolean;
	} = $props();
	const { workspace, reader, navigation, openWorkspaceCreationDialog } = getWorkspaceContext();
	let switcherOpen = $state(false);
</script>

<AppNavbar
	{workspace}
	bulkSelectionActive={reader.bulkSelection.active}
	{readerShown}
	{workspaceShown}
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
	{#if workspaceShown}
		<WorkspaceSidebar
			bind:switcherOpen
			workspaces={workspace.catalogue?.workspaces ?? []}
			activeWorkspaceId={workspace.activeWorkspace?.id ?? null}
			todoSummary={reader.todos}
			todoFilter={reader.todoFilter}
			todoFileLoaded={readerShown}
			disabled={navigation.busy}
			pendingOperation={workspace.pendingOperation}
			selectWorkspace={navigation.selectWorkspace}
			deleteWorkspace={workspace.deleteWorkspace}
			openCreationDialog={openWorkspaceCreationDialog}
		/>
	{/if}
	<main data-slot="app-content" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
		{@render children()}
		{#if readerShown}
			<ReaderStatusBar
				activeWorkspace={workspace.activeWorkspace}
				todoFile={workspace.todoFile}
				todoSummary={reader.todos}
				pendingOperation={workspace.pendingOperation}
			/>
		{/if}
	</main>
</div>
