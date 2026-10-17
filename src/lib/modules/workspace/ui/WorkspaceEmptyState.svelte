<script lang="ts">
	import * as Alert from "$lib/shared/ui/alert";
	import { Button } from "$lib/shared/ui/button";
	import * as Empty from "$lib/shared/ui/empty";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import FolderOpen from "@lucide/svelte/icons/folder-open";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import type { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";

	type Props = {
		session: ElectronWorkspaceSessionState["session"];
		disabled: boolean;
		openWorkspaceCreationDialog: () => void;
	};

	let { session, disabled, openWorkspaceCreationDialog }: Props = $props();
	let viewport = $state<HTMLElement | null>(null);

	export function focusViewport(): void {
		viewport?.focus();
	}
</script>

<div class="min-h-0 min-w-0 flex-1">
	<ScrollArea
		bind:viewportRef={viewport}
		class="h-full w-full"
		aria-label="Todo item results"
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
				</Alert.Root>
			</Empty.Root>
		{:else}
			<Empty.Root aria-label="No active workspace">
				<Empty.Media variant="icon"><FolderOpen aria-hidden="true" /></Empty.Media>
				<Empty.Header>
					<Empty.Title>No workspace open</Empty.Title>
					<Empty.Description
						>Open or create a Workspace to start working with a Todo file.</Empty.Description
					>
				</Empty.Header>
				<Button {disabled} onclick={openWorkspaceCreationDialog}>New workspace</Button>
				{#if session.status === "empty" && session.warning}
					<p role="status">{session.warning}</p>
				{/if}
			</Empty.Root>
		{/if}
	</ScrollArea>
</div>
