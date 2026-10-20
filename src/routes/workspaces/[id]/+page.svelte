<script lang="ts">
	import { untrack } from "svelte";
	import { createQuery } from "@tanstack/svelte-query";
	import { getWorkspaceContext } from "$lib/app/app-context";
	import { createReaderState } from "$lib/app/reader-state.svelte";
	import AppShell from "$lib/app/AppShell.svelte";
	import WorkspaceContent from "$lib/modules/workspace/ui/WorkspaceContent.svelte";
	import { workspaceDestinationQuery } from "$lib/modules/workspace/state/workspace-queries";
	import { Skeleton } from "$lib/shared/ui/skeleton";
	import * as Alert from "$lib/shared/ui/alert";
	import { Button } from "$lib/shared/ui/button";
	import type { PageProps } from "./$types";
	let { data }: PageProps = $props();
	const { commands, navigation } = getWorkspaceContext();
	const destinationQuery = createQuery(() =>
		workspaceDestinationQuery(window.desktop, data.workspaceId)
	);
	const workspace = $derived(destinationQuery.data?.workspace ?? null);
	const todoFile = $derived(destinationQuery.data?.todo_file ?? null);
	const reader = createReaderState(
		() => workspace,
		() => todoFile,
		commands
	);
	// Reconcile ephemeral filter choices after an external RPC snapshot changes.
	$effect(() => {
		destinationQuery.dataUpdatedAt;
		untrack(() => reader.todoFilter.reconcileSource());
	});
</script>

<AppShell workspaceShown readerShown={!!todoFile} {workspace} {todoFile} {reader}>
	{#if destinationQuery.isPending}
		<div class="flex flex-col gap-4 p-6" role="status" aria-label="Loading Todo items">
			<Skeleton class="h-9 w-1/3" />
			{#each Array(6) as _}<Skeleton class="h-12 w-full" />{/each}
		</div>
	{:else}
		{#if destinationQuery.isError && !commands.isOperating}
			<Alert.Root variant="destructive" class="m-4 w-auto">
				<Alert.Title>Could not load Todo items</Alert.Title>
				<Alert.Description>{destinationQuery.error.message}</Alert.Description>
				<Button disabled={commands.isOperating} onclick={() => navigation.retry()}>Retry</Button>
			</Alert.Root>
		{/if}
		{#if workspace && todoFile}
			{#key data.workspaceId}
				<WorkspaceContent
					bind:creationOpen={reader.creationOpen}
					bulkSelection={reader.bulkSelection}
					{workspace}
					{todoFile}
					{commands}
					todoFilter={reader.todoFilter}
					filteredTodoItems={reader.filteredTodoItems}
				/>
			{/key}
		{/if}
	{/if}
</AppShell>
