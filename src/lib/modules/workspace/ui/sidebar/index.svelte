<script lang="ts">
	import type { Workspace } from "$lib/modules/workspace/domain/workspace";
	import { Separator } from "$lib/shared/ui/separator";
	import WorkspaceSwitcher from "../WorkspaceSwitcher.svelte";
	import Overview from "./Overview.svelte";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import PriorityFilter from "./PriorityFilter.svelte";

	type Props = {
		workspaces: Workspace[];
		activeWorkspaceId: string | null;
		selectWorkspace: (workspaceId: string) => Promise<void>;
		deleteWorkspace: (workspaceId: string) => Promise<void>;
		openCreationDialog: () => void;
		disabled?: boolean;
	};

	let {
		workspaces,
		activeWorkspaceId,
		selectWorkspace,
		deleteWorkspace,
		openCreationDialog,
		disabled = false,
	}: Props = $props();
</script>

<aside class="flex h-full shrink-0 flex-col overflow-hidden bg-sidebar">
	<div class="p-2">
		<WorkspaceSwitcher
			{workspaces}
			{activeWorkspaceId}
			{disabled}
			{selectWorkspace}
			{deleteWorkspace}
			{openCreationDialog}
		/>
	</div>
	<div class="px-2"><Separator /></div>
	<ScrollArea class="min-h-0 flex-1">
		<div class="flex flex-col p-4 gap-5">
			<Overview />
			<PriorityFilter />
		</div>
	</ScrollArea>
</aside>
