<script lang="ts">
	import type { Workspace } from "$lib/modules/workspace/domain/workspace";
	import type {
		WorkspaceSessionActionResult,
		WorkspaceSessionOperation,
	} from "$lib/modules/workspace/state/workspace-session-types";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import type { TodoFileSummary } from "$lib/modules/todo/domain/todo-file-summary";
	import WorkspaceSwitcher from "../WorkspaceSwitcher.svelte";
	import Overview from "./Overview.svelte";
	import SidebarFilters from "./SidebarFilters.svelte";
	import type { TodoFilterState } from "$lib/modules/todo/state/todo-filter.svelte";

	type Props = {
		workspaces: readonly Workspace[];
		todoSummary: TodoFileSummary;
		activeWorkspaceId: string | null;
		selectWorkspace: (workspaceId: string) => Promise<WorkspaceSessionActionResult>;
		deleteWorkspace: (workspaceId: string) => Promise<WorkspaceSessionActionResult>;
		openCreationDialog: () => void;
		disabled?: boolean;
		pendingOperation?: WorkspaceSessionOperation | null;
		todoFilter: TodoFilterState;
		todoFileLoaded?: boolean;
		collapsible?: "offcanvas" | "icon" | "none";
		switcherTrigger?: HTMLButtonElement | null;
	};

	let {
		workspaces,
		todoSummary,
		activeWorkspaceId,
		selectWorkspace,
		deleteWorkspace,
		openCreationDialog,
		disabled = false,
		pendingOperation = null,
		todoFilter,
		todoFileLoaded = false,
		collapsible = "offcanvas",
		switcherTrigger = $bindable(null),
	}: Props = $props();
</script>

<Sidebar.Root
	variant="inset"
	{collapsible}
	class="top-(--window-toolbar-height) h-[calc(100svh-var(--window-toolbar-height))]"
>
	<Sidebar.Header class="p-3">
		<WorkspaceSwitcher
			bind:trigger={switcherTrigger}
			{workspaces}
			{activeWorkspaceId}
			{disabled}
			{pendingOperation}
			{selectWorkspace}
			{deleteWorkspace}
			{openCreationDialog}
		/>
	</Sidebar.Header>
	<Sidebar.Content class="min-w-0 gap-0 overflow-hidden px-2">
		<div class="shrink-0">
			<Overview {todoSummary} {todoFilter} disabled={!todoFileLoaded || disabled} />
		</div>
		<div class="mx-2 my-2 shrink-0 border-t"></div>
		{#key activeWorkspaceId}
			<SidebarFilters {todoFilter} disabled={!todoFileLoaded || disabled} />
		{/key}
	</Sidebar.Content>
	<Sidebar.Footer class="p-4 text-xs text-muted-foreground">
		<span class="font-medium text-sidebar-foreground">Tuxedo</span>
		<span>Your Todo files, in one place.</span>
	</Sidebar.Footer>
</Sidebar.Root>
