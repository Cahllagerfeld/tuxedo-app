<script lang="ts">
	import { getWorkspaceContext } from "$lib/app/app-context";
	import AppShell from "$lib/app/AppShell.svelte";
	import WorkspaceContent from "$lib/modules/workspace/ui/WorkspaceContent.svelte";
	import WorkspaceRecovery from "$lib/modules/workspace/ui/WorkspaceRecovery.svelte";
	import { tick } from "svelte";
	import type { PageProps } from "./$types";
	let { data, params }: PageProps = $props();
	const { workspace, reader, navigation } = getWorkspaceContext();
	const destination = $derived(data.destination);
	const matchingFile = $derived(
		destination.status === "loaded" &&
			JSON.stringify(destination.todo_file) === JSON.stringify(workspace.todoFile)
	);
	const error = $derived(
		navigation.error ||
			data.destinationError ||
			(destination.status === "rejected"
				? destination.message
				: !matchingFile && workspace.todoFile
					? "The Todo file changed. Retry loading its current contents."
					: "") ||
			workspace.error ||
			workspace.warning
	);
	const readerAvailable = $derived(
		!error &&
			destination.status === "loaded" &&
			matchingFile &&
			destination.workspace.id === params.id &&
			workspace.activeWorkspace?.id === params.id
	);
	let recovery = $state<ReturnType<typeof WorkspaceRecovery>>();
	// Transfer owned DOM focus when an unreadable-file result removes the reader.
	$effect.pre(() => {
		if (
			!readerAvailable &&
			document.activeElement?.closest("[data-todo-reader], [data-todo-details]")
		)
			void tick().then(() => recovery?.focusViewport());
	});
</script>

<AppShell workspaceShown readerShown={readerAvailable}>
	{#if readerAvailable}
		{#key params.id}
			<WorkspaceContent
				bind:creationOpen={reader.creationOpen}
				bulkSelection={reader.bulkSelection}
				{workspace}
				todoFilter={reader.todoFilter}
				filteredTodoItems={reader.filteredTodoItems}
			/>
		{/key}
	{:else}
		<WorkspaceRecovery
			bind:this={recovery}
			message={error || "This Workspace is unavailable."}
			disabled={navigation.busy}
			retry={navigation.retry}
		/>
	{/if}
</AppShell>
