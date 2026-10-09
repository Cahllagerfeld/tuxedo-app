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
	import FacetFilter from "./FacetFilter.svelte";
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
	<Sidebar.Content class="gap-2 px-2">
		<Overview {todoSummary} {todoFilter} disabled={!todoFileLoaded || disabled} />
		<FacetFilter
			label="Projects"
			values={todoSummary.facets.projects}
			selected={todoFilter.selectedProject}
			prefix="+"
			disabled={!todoFileLoaded || disabled}
			onSelect={todoFilter.toggleProject}
		/>
		<FacetFilter
			label="Contexts"
			values={todoSummary.facets.contexts}
			selected={todoFilter.selectedContext}
			prefix="@"
			disabled={!todoFileLoaded || disabled}
			onSelect={todoFilter.toggleContext}
		/>
		<FacetFilter
			label="Priorities"
			values={todoSummary.facets.priorities}
			selected={todoFilter.selectedPriority}
			disabled={!todoFileLoaded || disabled || todoFilter.status === "completed"}
			onSelect={todoFilter.togglePriority}
		/>
		{#if todoFileLoaded && todoFilter.hasFacetFilters}
			<button
				type="button"
				class="mx-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground underline-offset-4 hover:bg-sidebar-accent hover:text-sidebar-foreground hover:underline"
				{disabled}
				onclick={todoFilter.clear}>Clear filters</button
			>
		{/if}
	</Sidebar.Content>
	<Sidebar.Footer class="p-4 text-xs text-muted-foreground">
		<span class="font-medium text-sidebar-foreground">Tuxedo</span>
		<span>Your Todo files, in one place.</span>
	</Sidebar.Footer>
</Sidebar.Root>
