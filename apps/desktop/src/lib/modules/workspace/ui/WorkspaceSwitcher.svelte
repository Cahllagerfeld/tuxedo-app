<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Plus from "@lucide/svelte/icons/plus";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import WorkspaceOptionsMenu from "./WorkspaceOptionsMenu.svelte";
	import WorkspaceRemovalDialog from "./WorkspaceRemovalDialog.svelte";
	import { Button } from "#lib/shared/ui/button/index.js";
	import * as DropdownMenu from "#lib/shared/ui/dropdown-menu/index.js";
	import type { Workspace } from "#lib/modules/workspace/domain/workspace.js";
	import type {
		WorkspaceSessionActionResult,
		WorkspaceSessionOperation,
	} from "#lib/modules/workspace/state/workspace-session-types.js";

	type Props = {
		open?: boolean;
		workspaces: readonly Workspace[];
		activeWorkspaceId: string | null;
		selectWorkspace: (workspaceId: string) => void;
		deleteWorkspace: (workspaceId: string) => Promise<WorkspaceSessionActionResult>;
		openCreationDialog: () => void;
		disabled?: boolean;
		pendingOperation?: WorkspaceSessionOperation | null;
	};

	import { workspaceColorClasses } from "./workspace-colors";

	let {
		open = $bindable(false),
		workspaces,
		activeWorkspaceId,
		selectWorkspace,
		deleteWorkspace,
		openCreationDialog,
		disabled = false,
		pendingOperation = null,
	}: Props = $props();
	let isDeleteDialogOpen = $state(false);
	let workspaceToDelete = $state<Workspace | null>(null);
	const sortedWorkspaces = $derived(
		[...workspaces].sort((left, right) => left.created_at.localeCompare(right.created_at))
	);
	const activeWorkspace = $derived(workspaces.find(({ id }) => id === activeWorkspaceId) ?? null);
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger
		>{#snippet child({ props })}<Button
				{...props}
				variant="ghost"
				{disabled}
				class="h-10 w-full max-w-full justify-between gap-2 px-2 hover:bg-sidebar-accent"
			>
				{#if activeWorkspace}
					<span
						class={`size-2.5 shrink-0 rounded-full ${workspaceColorClasses[activeWorkspace.color]}`}
						aria-hidden="true"
					></span>
				{/if}
				<span class="min-w-0 flex-1 truncate text-left text-sm font-semibold">
					{activeWorkspace?.name ?? "No workspace selected"}
				</span>
				{#if pendingOperation === "open_workspace" || pendingOperation === "delete_workspace"}
					<LoaderCircle class="shrink-0 animate-spin" aria-hidden="true" />
				{:else}
					<ChevronDown class="shrink-0" aria-hidden="true" />
				{/if}
				<span class="sr-only"
					>Select workspace: {activeWorkspace?.name ?? "No workspace selected"}</span
				>
			</Button>{/snippet}</DropdownMenu.Trigger
	>
	<DropdownMenu.Content class="w-64 max-w-[calc(100vw-2rem)]">
		<DropdownMenu.Label>Workspaces</DropdownMenu.Label>
		{#if sortedWorkspaces.length}
			{#each sortedWorkspaces as workspace (workspace.id)}
				<div
					class={[
						"relative flex items-center gap-1 rounded-sm",
						!disabled && "focus-within:bg-accent/50 hover:bg-accent/50",
					]}
				>
					<DropdownMenu.Item
						class="static min-w-0 flex-1 after:absolute after:inset-0 after:rounded-sm focus:bg-transparent"
						aria-label={workspace.id === activeWorkspaceId
							? `${workspace.name}, active`
							: workspace.name}
						aria-current={workspace.id === activeWorkspaceId ? "true" : undefined}
						{disabled}
						onclick={() => selectWorkspace(workspace.id)}
					>
						<span
							class={`size-2 shrink-0 rounded-full ${workspaceColorClasses[workspace.color]}`}
							aria-hidden="true"
						></span>
						<span class="truncate">{workspace.name}</span>
						{#if workspace.id === activeWorkspaceId}<span
								class="ml-auto text-xs text-muted-foreground">Active</span
							>{/if}
					</DropdownMenu.Item>
					<WorkspaceOptionsMenu
						workspaceName={workspace.name}
						{disabled}
						nested
						onRemove={() => {
							open = false;
							workspaceToDelete = workspace;
							isDeleteDialogOpen = true;
						}}
					/>
				</div>
			{/each}
		{:else}
			<p class="px-2 py-1.5 text-sm text-muted-foreground">No saved workspaces yet.</p>
		{/if}
		<DropdownMenu.Separator />
		<DropdownMenu.Item {disabled} onclick={openCreationDialog}>
			<Plus aria-hidden="true" />
			New workspace
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>

<WorkspaceRemovalDialog
	bind:open={isDeleteDialogOpen}
	workspace={workspaceToDelete}
	{disabled}
	{deleteWorkspace}
/>
