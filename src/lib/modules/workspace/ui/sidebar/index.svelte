<script lang="ts">
	import type { Workspace } from "$lib/modules/workspace/domain/workspace";
	import type {
		WorkspaceSessionActionResult,
		WorkspaceSessionOperation,
	} from "$lib/modules/workspace/state/workspace-session-types";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import { Button } from "$lib/shared/ui/button";
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
	}: Props = $props();
</script>

<Sidebar.Root
	variant="inset"
	{collapsible}
	class="top-(--window-toolbar-height) h-[calc(100svh-var(--window-toolbar-height))]"
>
	<Sidebar.Header class="p-3">
		<WorkspaceSwitcher
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
			<SidebarFilters {todoSummary} {todoFilter} disabled={!todoFileLoaded || disabled} />
		{/key}
		{#if todoFileLoaded && todoFilter.hasFacetFilters}
			<Button
				variant="ghost"
				size="sm"
				class="mx-2 mt-2 shrink-0 justify-start px-2 text-xs font-normal text-muted-foreground"
				{disabled}
				onclick={todoFilter.clear}>Clear filters</Button
			>
		{/if}
	</Sidebar.Content>
	<Sidebar.Footer class="p-4 text-xs text-muted-foreground">
		<span class="font-medium text-sidebar-foreground">Tuxedo</span>
		<span>Your Todo files, in one place.</span>
	</Sidebar.Footer>
</Sidebar.Root>
