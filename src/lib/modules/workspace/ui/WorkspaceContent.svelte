<script lang="ts">
	import { onMount } from "svelte";
	import { localToday } from "$lib/modules/todo/domain/todo-due";
	import type { TodoItem } from "$lib/modules/todo/domain/todo";
	import WorkspaceTodoReader from "./WorkspaceTodoReader.svelte";
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
	};

	let {
		creationOpen = $bindable(false),
		bulkSelection,
		workspace,
		todoFilter,
		filteredTodoItems,
	}: Props = $props();
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
	<WorkspaceTodoReader
		bind:this={reader}
		{workspace}
		{todoFilter}
		{filteredTodoItems}
		{bulkSelection}
	/>
</div>
