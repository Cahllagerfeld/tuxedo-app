<script lang="ts">
	import { onMount, tick } from "svelte";
	import { localToday } from "$lib/modules/todo/domain/todo-due";
	import type { TodoItem } from "$lib/modules/todo/domain/todo";
	import WorkspaceTodoReader from "./WorkspaceTodoReader.svelte";
	import WorkspaceEmptyState from "./WorkspaceEmptyState.svelte";
	import type { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";
	import type { TodoFilterState } from "$lib/modules/todo/state/todo-filter.svelte";
	import { createTodoBulkSelection } from "./todo-bulk-selection.svelte";
	import WorkspaceToolbar from "./WorkspaceToolbar.svelte";

	type Props = {
		creationOpen?: boolean;
		bulkSelection: ReturnType<typeof createTodoBulkSelection>;
		workspace: ElectronWorkspaceSessionState;
		todoFilter: TodoFilterState;
		filteredTodoItems: readonly TodoItem[];
		openWorkspaceCreationDialog: () => void;
	};

	let {
		creationOpen = $bindable(false),
		bulkSelection,
		workspace,
		todoFilter,
		filteredTodoItems,
		openWorkspaceCreationDialog,
	}: Props = $props();
	let emptyState = $state<ReturnType<typeof WorkspaceEmptyState>>();
	// A session becoming Empty removes the reader and its focused surface. Transfer owned focus after the replacement mounts.
	$effect.pre(() => {
		if (
			!workspace.todoFile &&
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
		{workspace}
		{todoFilter}
		{bulkSelection}
		{filteredTodoItems}
		bind:creationOpen
		closeDetails={() => reader?.closeDetails()}
		focusTodo={(todo) => void reader?.focusTodo(todo)}
	/>
	{#if workspace.todoFile}
		<WorkspaceTodoReader
			bind:this={reader}
			{workspace}
			{todoFilter}
			{filteredTodoItems}
			{bulkSelection}
		/>
	{:else}
		<WorkspaceEmptyState
			bind:this={emptyState}
			session={workspace.session}
			disabled={workspace.isOperating || workspace.isLoading}
			{openWorkspaceCreationDialog}
		/>
	{/if}
</div>
