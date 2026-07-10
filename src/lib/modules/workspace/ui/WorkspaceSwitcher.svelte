<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Plus from "@lucide/svelte/icons/plus";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import * as AlertDialog from "$lib/shared/ui/alert-dialog";
	import { Button } from "$lib/shared/ui/button";
	import * as DropdownMenu from "$lib/shared/ui/dropdown-menu";
	import type { Workspace } from "$lib/modules/workspace/domain/workspace";

	type Props = {
		workspaces: Workspace[];
		activeWorkspaceId: string | null;
		selectWorkspace: (workspaceId: string) => Promise<void>;
		deleteWorkspace: (workspaceId: string) => Promise<void>;
		openCreationDialog: () => void;
	};

	const colorClasses: Record<Workspace["color"], string> = {
		blue: "bg-blue-600 dark:bg-blue-400",
		green: "bg-green-600 dark:bg-green-400",
		amber: "bg-amber-600 dark:bg-amber-400",
		red: "bg-red-600 dark:bg-red-400",
		violet: "bg-violet-600 dark:bg-violet-400",
		pink: "bg-pink-600 dark:bg-pink-400",
		cyan: "bg-cyan-600 dark:bg-cyan-400",
		orange: "bg-orange-600 dark:bg-orange-400",
	};

	let {
		workspaces,
		activeWorkspaceId,
		selectWorkspace,
		deleteWorkspace,
		openCreationDialog,
	}: Props = $props();
	let isDeleteDialogOpen = $state(false);
	let workspaceToDelete = $state<Workspace | null>(null);
	const sortedWorkspaces = $derived(
		[...workspaces].sort((left, right) => left.created_at.localeCompare(right.created_at))
	);
	const activeWorkspace = $derived(workspaces.find(({ id }) => id === activeWorkspaceId) ?? null);

	async function confirmDeletion() {
		try {
			if (workspaceToDelete) {
				await deleteWorkspace(workspaceToDelete.id);
			}
		} finally {
			isDeleteDialogOpen = false;
			workspaceToDelete = null;
		}
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		>{#snippet child({ props })}<Button {...props} variant="ghost" class="max-w-64 gap-1 px-2">
				<span class="truncate font-mono text-sm">
					{activeWorkspace?.name ?? "No workspace selected"}
				</span>
				<ChevronDown aria-hidden="true" />
				<span class="sr-only"
					>Select workspace: {activeWorkspace?.name ?? "No workspace selected"}</span
				>
			</Button>{/snippet}</DropdownMenu.Trigger
	>
	<DropdownMenu.Content class="min-w-64">
		<DropdownMenu.Label>Workspaces</DropdownMenu.Label>
		{#if sortedWorkspaces.length}
			{#each sortedWorkspaces as workspace}
				<DropdownMenu.Item
					aria-label={workspace.id === activeWorkspaceId
						? `${workspace.name}, active`
						: workspace.name}
					aria-current={workspace.id === activeWorkspaceId ? "true" : undefined}
					onclick={() => void selectWorkspace(workspace.id)}
				>
					<span
						class={`size-2 shrink-0 rounded-full ${colorClasses[workspace.color]}`}
						aria-hidden="true"
					></span>
					<span class="truncate">{workspace.name}</span>
					{#if workspace.id === activeWorkspaceId}<span
							class="ml-auto text-xs text-muted-foreground">Active</span
						>{/if}
				</DropdownMenu.Item>
			{/each}
		{:else}
			<p class="px-2 py-1.5 text-sm text-muted-foreground">No saved workspaces yet.</p>
		{/if}
		{#if activeWorkspace}
			<DropdownMenu.Separator />
			<DropdownMenu.Item
				variant="destructive"
				aria-label={`Delete ${activeWorkspace.name}`}
				onclick={() => {
					workspaceToDelete = activeWorkspace;
					isDeleteDialogOpen = true;
				}}
			>
				<Trash2 aria-hidden="true" />
				Delete {activeWorkspace.name}
			</DropdownMenu.Item>
		{/if}
		<DropdownMenu.Separator />
		<DropdownMenu.Item onclick={openCreationDialog}>
			<Plus aria-hidden="true" />
			New workspace
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>

<AlertDialog.Root bind:open={isDeleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Workspace?</AlertDialog.Title>
			<AlertDialog.Description>
				Delete {workspaceToDelete?.name ?? "this Workspace"} from saved Workspaces? Its Todo file will
				not be deleted.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={confirmDeletion}
				>Delete workspace</AlertDialog.Action
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
