<script lang="ts">
	import * as AlertDialog from "$lib/shared/ui/alert-dialog";
	import { toast } from "svelte-sonner";
	import type { Workspace } from "../domain/workspace";
	import type { WorkspaceSessionActionResult } from "../state/workspace-session-types";

	let {
		open = $bindable(false),
		workspace,
		disabled,
		deleteWorkspace,
	}: {
		open?: boolean;
		workspace: Workspace | null;
		disabled: boolean;
		deleteWorkspace: (workspaceId: string) => Promise<WorkspaceSessionActionResult>;
	} = $props();

	async function confirmDeletion() {
		if (!workspace || disabled) return;

		const selected = workspace;
		open = false;
		try {
			const result = await deleteWorkspace(selected.id);
			if (result.status === "rejected")
				toast.error("Could not remove workspace", { description: result.message });
		} catch (error) {
			toast.error("Could not remove workspace", { description: errorMessage(error) });
		}
	}

	function errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove workspace?</AlertDialog.Title>
			<AlertDialog.Description>
				Remove {workspace?.name ?? "this Workspace"} from saved Workspaces? Its Todo file will not be
				deleted.
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
