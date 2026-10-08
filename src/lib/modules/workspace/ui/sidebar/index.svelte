<script lang="ts">
	import type { Workspace } from "$lib/modules/workspace/domain/workspace";
	import type {
		WorkspaceSessionActionResult,
		WorkspaceSessionOperation,
	} from "$lib/modules/workspace/state/workspace-session-types";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import type { TodoFileSummary } from "$lib/modules/todo/domain/todo-file-summary";
	import Folder from "@lucide/svelte/icons/folder";
	import WorkspaceSwitcher from "../WorkspaceSwitcher.svelte";
	import Overview from "./Overview.svelte";

	import PriorityFilter from "./PriorityFilter.svelte";

	type Props = {
		workspaces: readonly Workspace[];
		todoSummary: TodoFileSummary;
		activeWorkspaceId: string | null;
		selectWorkspace: (workspaceId: string) => Promise<WorkspaceSessionActionResult>;
		deleteWorkspace: (workspaceId: string) => Promise<WorkspaceSessionActionResult>;
		openCreationDialog: () => void;
		disabled?: boolean;
		pendingOperation?: WorkspaceSessionOperation | null;
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
	}: Props = $props();
</script>

<Sidebar.Root variant="inset" collapsible="offcanvas">
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
		<Overview {todoSummary} />
		{#if todoSummary.facets.projects.length > 0}
			<Sidebar.Group>
				<Sidebar.GroupLabel>Projects</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					<ul class="space-y-0.5">
						{#each todoSummary.facets.projects as project (project)}
							<li class="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm">
								<Folder class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
								<span class="truncate" title={project}>+{project}</span>
							</li>
						{/each}
					</ul>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		{/if}
		<PriorityFilter {todoSummary} />
	</Sidebar.Content>
	<Sidebar.Footer class="p-4 text-xs text-muted-foreground">
		<span class="font-medium text-sidebar-foreground">Tuxedo</span>
		<span>Your Todo files, in one place.</span>
	</Sidebar.Footer>
</Sidebar.Root>
