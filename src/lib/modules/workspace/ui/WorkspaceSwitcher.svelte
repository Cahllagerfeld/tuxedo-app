<script lang="ts">
	import { resolve } from "$app/paths";
	import type { Workspace } from "$lib/modules/workspace/domain/workspace";
	import type {
		WorkspaceSessionActionResult,
		WorkspaceSessionOperation,
	} from "$lib/modules/workspace/state/workspace-session-types";
	import * as AlertDialog from "$lib/shared/ui/alert-dialog";
	import { Button } from "$lib/shared/ui/button";
	import * as DropdownMenu from "$lib/shared/ui/dropdown-menu";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import Plus from "@lucide/svelte/icons/plus";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import { toast } from "svelte-sonner";

	type Props = {
		open?: boolean;
		workspaces: readonly Workspace[];
		activeWorkspaceId: string | null;
		deleteWorkspace: (workspaceId: string) => Promise<WorkspaceSessionActionResult>;
		openCreationDialog: () => void;
		disabled?: boolean;
		pendingOperation?: WorkspaceSessionOperation | null;
	};

	import { workspaceColorClasses as colorClasses } from "./workspace-colors";

	let {
		open = $bindable(false),
		workspaces,
		activeWorkspaceId,
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

	async function confirmDeletion() {
		if (!workspaceToDelete || disabled) return;

		const workspace = workspaceToDelete;
		isDeleteDialogOpen = false;
		workspaceToDelete = null;
		try {
			const result = await deleteWorkspace(workspace.id);
			if (result.status === "rejected")
				toast.error("Could not remove workspace", { description: result.message });
			else if (result.status === "applied" && result.notice) toast.info(result.notice);
		} catch (error) {
			toast.error("Could not remove workspace", { description: errorMessage(error) });
		}
	}

	function errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
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
						class={`size-2.5 shrink-0 rounded-full ${colorClasses[activeWorkspace.color]}`}
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
				<div class="flex items-center gap-1">
					<DropdownMenu.Item
						class="min-w-0 flex-1"
						aria-label={workspace.id === activeWorkspaceId
							? `${workspace.name}, active`
							: workspace.name}
						aria-current={workspace.id === activeWorkspaceId ? "true" : undefined}
						{disabled}
					>
						{#snippet child({ props })}
							<a
								{...props}
								href={disabled ? undefined : resolve("/workspaces/[id]", { id: workspace.id })}
							>
								<span
									class={`size-2 shrink-0 rounded-full ${colorClasses[workspace.color]}`}
									aria-hidden="true"
								></span>
								<span class="truncate">{workspace.name}</span>
								{#if workspace.id === activeWorkspaceId}<span
										class="ml-auto text-xs text-muted-foreground">Active</span
									>{/if}
							</a>
						{/snippet}
					</DropdownMenu.Item>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger {disabled}>
							{#snippet child({ props })}
								<DropdownMenu.Item
									{...props}
									{disabled}
									closeOnSelect={false}
									aria-label={`Options for ${workspace.name}`}
									class="shrink-0 hover:bg-accent hover:text-accent-foreground"
								>
									<Ellipsis aria-hidden="true" />
								</DropdownMenu.Item>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content side="right" align="start" class="w-auto">
							<DropdownMenu.Item
								variant="destructive"
								{disabled}
								onclick={() => {
									open = false;
									workspaceToDelete = workspace;
									isDeleteDialogOpen = true;
								}}
							>
								<Trash2 aria-hidden="true" />
								Remove workspace
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
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

<AlertDialog.Root bind:open={isDeleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove workspace?</AlertDialog.Title>
			<AlertDialog.Description>
				Remove {workspaceToDelete?.name ?? "this Workspace"} from saved Workspaces? Its Todo file will
				not be deleted.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" {disabled} onclick={confirmDeletion}
				>Remove workspace</AlertDialog.Action
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
