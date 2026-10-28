<script lang="ts">
	import { onMount, tick, type Snippet } from "svelte";
	import { localToday } from "#lib/modules/todo/domain/todo-due.js";
	import type { WorkspaceViewMode } from "../domain/workspace.js";
	import type { TodoItem } from "#lib/modules/todo/domain/todo.js";
	import WorkspaceTodoReader from "./WorkspaceTodoReader.svelte";
	import WorkspaceEmptyState from "./WorkspaceEmptyState.svelte";
	import type { WorkspaceCommands } from "../state/workspace-commands.svelte";
	import type { WorkspaceSessionActionResult } from "../state/workspace-session-types.js";
	import type { WorkspaceView } from "../state/workspace-view.js";
	import type { TodoFilterState } from "#lib/modules/todo/state/todo-filter.svelte.js";
	import { createTodoBulkSelection } from "./todo-bulk-selection.svelte";
	import WorkspaceToolbar from "./WorkspaceToolbar.svelte";

	type Props = {
		children: Snippet;
		viewMode?: WorkspaceViewMode;
		creationOpen?: boolean;
		bulkSelection: ReturnType<typeof createTodoBulkSelection>;
		workspace: WorkspaceCommands;
		view: WorkspaceView;
		deleteWorkspace: (id: string) => Promise<WorkspaceSessionActionResult>;
		todoFilter: TodoFilterState;
		filteredTodoItems: readonly TodoItem[];
		openWorkspaceCreationDialog: () => void;
	};

	let {
		children,
		viewMode = "list",
		creationOpen = $bindable(false),
		bulkSelection,
		workspace,
		view,
		deleteWorkspace,
		todoFilter,
		filteredTodoItems,
		openWorkspaceCreationDialog,
	}: Props = $props();
	let emptyState = $state<ReturnType<typeof WorkspaceEmptyState>>();
	// A session becoming Empty removes the reader and its focused surface. Transfer owned focus after the replacement mounts.
	$effect.pre(() => {
		if (
			!view.todoFile &&
			document.activeElement?.closest("[data-todo-reader], [data-todo-details]")
		) {
			void tick().then(() => emptyState?.focusViewport());
		}
	});
	let reader = $state<ReturnType<typeof WorkspaceTodoReader>>();

	onMount(() => {
		let timer: ReturnType<typeof setTimeout>;
		function refreshDate() {
			clearTimeout(timer);
			const now = new Date();
			todoFilter.today = localToday(now);
			const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
			timer = setTimeout(refreshDate, midnight.getTime() - now.getTime());
		}
		refreshDate();
		window.addEventListener("focus", refreshDate);
		document.addEventListener("visibilitychange", refreshDate);
		return () => {
			clearTimeout(timer);
			window.removeEventListener("focus", refreshDate);
			document.removeEventListener("visibilitychange", refreshDate);
		};
	});
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	<WorkspaceToolbar
		{viewMode}
		{workspace}
		{view}
		{todoFilter}
		{bulkSelection}
		{filteredTodoItems}
		bind:creationOpen
		closeDetails={() => reader?.closeDetails()}
		focusTodo={(todo) => void reader?.focusTodo(todo)}
	/>
	{#if view.todoFile}
		<WorkspaceTodoReader
			{viewMode}
			bind:this={reader}
			{workspace}
			{view}
			{todoFilter}
			{filteredTodoItems}
			{bulkSelection}
			onCreate={() => (creationOpen = true)}
		>
			{@render children()}
		</WorkspaceTodoReader>
	{:else}
		<WorkspaceEmptyState
			bind:this={emptyState}
			session={view.session}
			{deleteWorkspace}
			disabled={workspace.isOperating || view.isLoading}
			{openWorkspaceCreationDialog}
		/>
	{/if}
</div>
