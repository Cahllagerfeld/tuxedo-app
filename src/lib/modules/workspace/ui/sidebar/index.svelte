<script lang="ts">
	import type { Workspace } from "$lib/modules/workspace/domain/workspace";
	import type {
		WorkspaceSessionActionResult,
		WorkspaceSessionOperation,
	} from "$lib/modules/workspace/state/workspace-session-state.svelte";
	import { Separator } from "$lib/shared/ui/separator";
	import WorkspaceSwitcher from "../WorkspaceSwitcher.svelte";
	import Overview from "./Overview.svelte";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import PriorityFilter from "./PriorityFilter.svelte";

	type Props = {
		workspaces: readonly Workspace[];
		activeWorkspaceId: string | null;
		selectWorkspace: (workspaceId: string) => Promise<WorkspaceSessionActionResult>;
		deleteWorkspace: (workspaceId: string) => Promise<WorkspaceSessionActionResult>;
		openCreationDialog: () => void;
		disabled?: boolean;
		pendingOperation?: WorkspaceSessionOperation | null;
		workspaceSwitcherOpen?: boolean;
	};

	let {
		workspaces,
		activeWorkspaceId,
		selectWorkspace,
		deleteWorkspace,
		openCreationDialog,
		disabled = false,
		pendingOperation = null,
		workspaceSwitcherOpen = $bindable(false),
	}: Props = $props();
</script>

<aside class="flex h-full shrink-0 flex-col overflow-hidden bg-sidebar">
	<div class="p-2">
		<WorkspaceSwitcher
			{workspaces}
			{activeWorkspaceId}
			{disabled}
			{pendingOperation}
			{selectWorkspace}
			{deleteWorkspace}
			{openCreationDialog}
			bind:open={workspaceSwitcherOpen}
		/>
	</div>
	<div class="px-2"><Separator /></div>
	<ScrollArea class="min-h-0 flex-1">
		<div class="flex flex-col gap-5 p-4">
			<Overview />
			<PriorityFilter />
		</div>
	</ScrollArea>
</aside>
