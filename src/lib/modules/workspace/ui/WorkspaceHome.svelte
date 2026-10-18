<script lang="ts">
	import * as Alert from "$lib/shared/ui/alert";
	import { Button } from "$lib/shared/ui/button";
	import FolderOpen from "@lucide/svelte/icons/folder-open";
	import Plus from "@lucide/svelte/icons/plus";
	import type { WorkspaceCatalogue } from "../domain/workspace";
	import WorkspaceList from "./WorkspaceList.svelte";

	let {
		catalogue,
		warning,
		disabled,
		openWorkspaceCreationDialog,
	}: {
		catalogue: WorkspaceCatalogue;
		warning?: string | null;
		disabled: boolean;
		openWorkspaceCreationDialog: () => void;
	} = $props();
	const workspaces = $derived(
		[...catalogue.workspaces].sort((left, right) => left.created_at.localeCompare(right.created_at))
	);
</script>

<section
	aria-label="Workspace home"
	class="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 sm:px-12 sm:py-20"
>
	<header class="mb-10 flex flex-wrap items-end justify-between gap-6">
		<div>
			<p class="mb-4 text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
				A place for your Todo files
			</p>
			<h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">Your workspaces.</h1>
			<p class="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
				{workspaces.length
					? "Pick a Workspace and get back to what matters."
					: "A clearer view of what’s next. Start with a Todo file of your own."}
			</p>
		</div>
		{#if workspaces.length}
			<Button {disabled} onclick={openWorkspaceCreationDialog} class="gap-2 px-4"
				><Plus aria-hidden="true" />New workspace</Button
			>
		{/if}
	</header>

	{#if warning}
		<Alert.Root class="mb-6">
			<Alert.Title>Could not open your last Workspace</Alert.Title>
			<Alert.Description>{warning}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if workspaces.length}
		<WorkspaceList {workspaces} activeWorkspaceId={catalogue.active_workspace_id} {disabled} />
	{:else}
		<div
			aria-label="No active workspace"
			class="flex flex-col items-center rounded-2xl border border-dashed bg-muted/20 px-6 py-14 text-center sm:py-20"
		>
			<div
				class="mb-6 flex size-16 items-center justify-center rounded-2xl border bg-background shadow-sm"
			>
				<FolderOpen class="size-7 text-muted-foreground" aria-hidden="true" />
			</div>
			<h2 class="text-xl font-semibold tracking-tight">No workspace open</h2>
			<p class="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
				Connect an existing Todo file. Give it a name and a color, and make it your Workspace.
			</p>
			<Button {disabled} onclick={openWorkspaceCreationDialog} class="mt-7 gap-2 px-4"
				><Plus aria-hidden="true" />New workspace</Button
			>
		</div>
	{/if}
</section>
