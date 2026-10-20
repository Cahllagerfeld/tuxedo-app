<script lang="ts">
	import type { Workspace } from "$lib/modules/workspace/domain/workspace";
	import type { TodoFile } from "$lib/shared/desktop/todo";
	import type { createReaderState } from "./reader-state.svelte";
	import type { Snippet } from "svelte";
	import { getWorkspaceContext } from "./app-context";
	import AppNavbar from "./AppNavbar.svelte";
	import ReaderStatusBar from "./ReaderStatusBar.svelte";
	import WorkspaceSidebar from "$lib/modules/workspace/ui/sidebar/index.svelte";
	let {
		children,
		workspace = null,
		todoFile = null,
		reader,
		workspaceShown = false,
		readerShown = false,
	}: {
		children: Snippet;
		workspace?: Workspace | null;
		todoFile?: TodoFile | null;
		reader?: ReturnType<typeof createReaderState>;
		workspaceShown?: boolean;
		readerShown?: boolean;
	} = $props();
	const { sessionQuery, commands, navigation, openWorkspaceCreationDialog } = getWorkspaceContext();
	const catalogue = $derived(
		sessionQuery.data?.session.status === "ready" || sessionQuery.data?.session.status === "empty"
			? sessionQuery.data.session.catalogue
			: null
	);
	const undoLabel = $derived(
		sessionQuery.data?.session.status === "ready" &&
			(!workspace || sessionQuery.data.session.catalogue.active_workspace_id === workspace.id)
			? sessionQuery.data.undoLabel
			: undefined
	);
	const shortcutTodoFile = $derived(
		todoFile ??
			(sessionQuery.data?.session.status === "ready" ? sessionQuery.data.session.todo_file : null)
	);
	let switcherOpen = $state(false);
</script>

<AppNavbar
	todoFile={shortcutTodoFile}
	{undoLabel}
	{commands}
	bulkSelectionActive={reader?.bulkSelection.active ?? false}
	{readerShown}
	{workspaceShown}
	openWorkspaceSwitcher={() => {
		switcherOpen = true;
	}}
	{openWorkspaceCreationDialog}
	openTodoCreation={() => {
		if (reader) reader.creationOpen = true;
	}}
/>
<div
	data-slot="app-inset"
	class="relative m-1 flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-background shadow-sm"
>
	{#if workspaceShown && reader}
		<WorkspaceSidebar
			bind:switcherOpen
			workspaces={catalogue?.workspaces ?? []}
			activeWorkspaceId={workspace?.id ?? null}
			todoSummary={reader.todos}
			todoFilter={reader.todoFilter}
			todoFileLoaded={readerShown}
			disabled={navigation.busy}
			pendingOperation={commands.pendingOperation}
			selectWorkspace={navigation.selectWorkspace}
			deleteWorkspace={commands.deleteWorkspace}
			openCreationDialog={openWorkspaceCreationDialog}
		/>
	{/if}
	<main data-slot="app-content" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
		{@render children()}
		{#if readerShown && reader}
			<ReaderStatusBar
				activeWorkspace={workspace}
				{todoFile}
				todoSummary={reader.todos}
				pendingOperation={commands.pendingOperation}
			/>
		{/if}
	</main>
</div>
