<script lang="ts">
	import { getWorkspaceContext } from "$lib/app/app-context";
	import AppShell from "$lib/app/AppShell.svelte";
	import WorkspaceContent from "$lib/modules/workspace/ui/WorkspaceContent.svelte";
	import type { PageProps } from "./$types";
	let { data }: PageProps = $props();
	const { workspace, reader } = getWorkspaceContext();
</script>

<AppShell workspaceShown readerShown>
	{#key data.destination.workspace.id}
		<WorkspaceContent
			bind:creationOpen={reader.creationOpen}
			bulkSelection={reader.bulkSelection}
			{workspace}
			todoFilter={reader.todoFilter}
			filteredTodoItems={reader.filteredTodoItems}
		/>
	{/key}
</AppShell>
