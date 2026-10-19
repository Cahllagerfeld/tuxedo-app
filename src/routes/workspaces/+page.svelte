<script lang="ts">
	import AppShell from "$lib/app/AppShell.svelte";
	import { getWorkspaceContext } from "$lib/app/app-context";
	import WorkspaceEmptyState from "$lib/modules/workspace/ui/WorkspaceEmptyState.svelte";
	import type { PageProps } from "./$types";
	let { data }: PageProps = $props();
	const { workspace, navigation, openWorkspaceCreationDialog } = getWorkspaceContext();
	const session = $derived(
		data.sessionData.confirmed
			? data.sessionData.confirmed.session
			: { status: "unavailable" as const, error: data.sessionData.error }
	);
</script>

<AppShell>
	<WorkspaceEmptyState
		{session}
		warning={navigation.error || data.unavailableMessage}
		deleteWorkspace={workspace.deleteWorkspace}
		disabled={navigation.busy}
		{openWorkspaceCreationDialog}
		retry={navigation.retry}
	/>
</AppShell>
