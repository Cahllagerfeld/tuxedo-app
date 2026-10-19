<script lang="ts">
	import type { WorkspaceSessionActionResult } from "../state/workspace-session-types";
	import * as Alert from "$lib/shared/ui/alert";
	import * as Empty from "$lib/shared/ui/empty";
	import { Button } from "$lib/shared/ui/button";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import WorkspaceHome from "./WorkspaceHome.svelte";
	import type { WorkspaceCommands } from "../state/workspace-commands.svelte";

	type Props = {
		session: WorkspaceCommands["session"];
		disabled: boolean;
		warning?: string;
		retry?: () => Promise<void>;
		deleteWorkspace: (workspaceId: string) => Promise<WorkspaceSessionActionResult>;
		openWorkspaceCreationDialog: () => void;
	};

	let { session, warning, disabled, deleteWorkspace, openWorkspaceCreationDialog, retry }: Props =
		$props();
	let viewport = $state<HTMLElement | null>(null);

	export function focusViewport(): void {
		viewport?.focus();
	}
</script>

<div class="min-h-0 min-w-0 flex-1">
	<ScrollArea
		bind:viewportRef={viewport}
		class="h-full w-full"
		aria-label="Workspaces"
		viewportTabIndex={-1}
	>
		{#if session.status === "loading"}
			<Empty.Root aria-label="Loading workspace session" class="min-h-full rounded-none border-0">
				<Empty.Media variant="icon"
					><LoaderCircle class="animate-spin" aria-hidden="true" /></Empty.Media
				>
				<Empty.Header>
					<Empty.Title>Loading workspaces…</Empty.Title>
					<Empty.Description>Restoring your Workspace session.</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else if session.status === "unavailable"}
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
				{deleteWorkspace}
				{disabled}
				{openWorkspaceCreationDialog}
			/>
		{/if}
	</ScrollArea>
</div>
