<script lang="ts">
	import { getWorkspaceContext } from "$lib/app/app-context";
	import WorkspaceContent from "$lib/modules/workspace/ui/WorkspaceContent.svelte";
	import WorkspaceRecovery from "$lib/modules/workspace/ui/WorkspaceRecovery.svelte";
	import { tick } from "svelte";
	import type { PageProps } from "./$types";
	let { data, params }: PageProps = $props();
	const { workspace, reader, navigation, openWorkspaceCreationDialog } = getWorkspaceContext();
	let recovery = $state<ReturnType<typeof WorkspaceRecovery>>();
	// Transfer owned DOM focus when an unreadable-file result removes the reader.
	$effect.pre(() => {
		if (
			!navigation.readerAvailable &&
			document.activeElement?.closest("[data-todo-reader], [data-todo-details]")
		)
			void tick().then(() => recovery?.focusViewport());
	});
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	{#if navigation.readerAvailable}
		{#key params.id}
			<WorkspaceContent
				bind:creationOpen={reader.creationOpen}
				bulkSelection={reader.bulkSelection}
				{workspace}
				todoFilter={reader.todoFilter}
				filteredTodoItems={reader.filteredTodoItems}
				{openWorkspaceCreationDialog}
			/>
		{/key}
	{:else}
		<WorkspaceRecovery
			bind:this={recovery}
			message={navigation.error ||
				(data.destination?.status === "rejected" ? data.destination.message : "") ||
				workspace.error ||
				workspace.warning ||
				"This Workspace is unavailable."}
			disabled={navigation.busy}
			retry={navigation.retry}
		/>
	{/if}
</div>
