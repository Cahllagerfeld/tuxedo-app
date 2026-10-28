<script lang="ts">
	import List from "@lucide/svelte/icons/list";
	import Columns3 from "@lucide/svelte/icons/columns-3";
	import { Button } from "#lib/shared/ui/button/index.js";
	import type { Workspace, WorkspaceViewMode } from "#lib/modules/workspace/domain/workspace.js";
	import type {
		WorkspaceSessionActionResult,
		WorkspaceSessionOperation,
	} from "#lib/modules/workspace/state/workspace-session-types.js";
	import WorkspaceSwitcher from "./WorkspaceSwitcher.svelte";

	let {
		switcherOpen = $bindable(false),
		workspaces,
		activeWorkspaceId,
		viewMode,
		listHref,
		kanbanHref,
		selectWorkspace,
		deleteWorkspace,
		openCreationDialog,
		disabled = false,
		pendingOperation = null,
	}: {
		switcherOpen?: boolean;
		workspaces: readonly Workspace[];
		activeWorkspaceId: string | null;
		viewMode: WorkspaceViewMode;
		listHref: string;
		kanbanHref: string;
		selectWorkspace: (workspaceId: string) => void;
		deleteWorkspace: (workspaceId: string) => Promise<WorkspaceSessionActionResult>;
		openCreationDialog: () => void;
		disabled?: boolean;
		pendingOperation?: WorkspaceSessionOperation | null;
	} = $props();
</script>

<nav
	aria-label="Workspace navigation"
	class="flex w-14 shrink-0 flex-col items-center gap-2 py-3 text-sidebar-foreground"
>
	<WorkspaceSwitcher
		bind:open={switcherOpen}
		{workspaces}
		{activeWorkspaceId}
		{disabled}
		{pendingOperation}
		{selectWorkspace}
		{deleteWorkspace}
		{openCreationDialog}
	/>
	<div class="mx-2 w-8 border-t"></div>
	<Button
		variant="ghost"
		size="icon-lg"
		href={listHref}
		{disabled}
		aria-label="List"
		title="List"
		aria-current={viewMode === "list" ? "page" : undefined}
		class={viewMode === "list"
			? "bg-foreground/10 text-foreground hover:bg-foreground/10 dark:hover:bg-foreground/10"
			: ""}><List aria-hidden="true" /></Button
	>
	<Button
		variant="ghost"
		size="icon-lg"
		href={kanbanHref}
		{disabled}
		aria-label="Kanban"
		title="Kanban"
		aria-current={viewMode === "kanban" ? "page" : undefined}
		class={viewMode === "kanban"
			? "bg-foreground/10 text-foreground hover:bg-foreground/10 dark:hover:bg-foreground/10"
			: ""}><Columns3 aria-hidden="true" /></Button
	>
</nav>
