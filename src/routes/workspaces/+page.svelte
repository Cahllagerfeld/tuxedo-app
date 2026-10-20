<script lang="ts">
	import AppShell from "$lib/app/AppShell.svelte";
	import { getWorkspaceContext } from "$lib/app/app-context";
	import WorkspaceEmptyState from "$lib/modules/workspace/ui/WorkspaceEmptyState.svelte";
	import type { PageProps } from "./$types";
	let { data }: PageProps = $props();
	const { workspace, commands, navigation, openWorkspaceCreationDialog } = getWorkspaceContext();
</script>

<AppShell>
	<WorkspaceEmptyState
		session={workspace.session}
		warning={navigation.error || data.unavailableMessage}
		deleteWorkspace={commands.deleteWorkspace}
		disabled={navigation.busy}
		{openWorkspaceCreationDialog}
		retry={navigation.retry}
	/>
</AppShell>
