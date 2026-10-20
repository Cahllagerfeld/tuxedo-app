<script lang="ts">
	import type { WorkspaceSessionActionResult } from "../state/workspace-session-types";
	import * as Alert from "$lib/shared/ui/alert";
	import * as Empty from "$lib/shared/ui/empty";
	import { Button } from "$lib/shared/ui/button";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import WorkspaceHome from "./WorkspaceHome.svelte";
	import type { ConfirmedSession } from "$lib/shared/desktop/contract";

	type Props = {
		session: ConfirmedSession["session"];
		disabled: boolean;
		warning?: string;
		retry?: () => Promise<void>;
		deleteWorkspace: (workspaceId: string) => Promise<WorkspaceSessionActionResult>;
		openWorkspaceCreationDialog: () => void;
	};

	let { session, warning, disabled, deleteWorkspace, openWorkspaceCreationDialog, retry }: Props =
		$props();
</script>

<div class="min-h-0 min-w-0 flex-1">
	<ScrollArea class="h-full w-full" aria-label="Workspaces" viewportTabIndex={-1}>
		{#if session.status === "unavailable"}
			<Empty.Root
				aria-label="Workspace catalogue unavailable"
				class="min-h-full rounded-none border-0"
			>
				<Alert.Root variant="destructive">
					<Alert.Title>Workspaces unavailable</Alert.Title>
					<Alert.Description>{session.error}</Alert.Description>
					{#if retry}<Button {disabled} onclick={retry}>Retry</Button>{/if}
				</Alert.Root>
			</Empty.Root>
		{:else}
			<WorkspaceHome
				catalogue={session.catalogue}
				warning={warning || (session.status === "empty" ? session.warning : undefined)}
				{retry}
				{deleteWorkspace}
				{disabled}
				{openWorkspaceCreationDialog}
			/>
		{/if}
	</ScrollArea>
</div>
