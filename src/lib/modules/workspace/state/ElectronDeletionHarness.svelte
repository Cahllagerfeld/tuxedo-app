<script lang="ts">
	import { createQuery } from "@tanstack/svelte-query";
	import { workspaceSessionQuery } from "$lib/modules/workspace/state/workspace-queries";
	import { onDestroy, onMount } from "svelte";
	import type { DesktopAPI } from "$lib/shared/desktop/contract";
	import { WorkspaceSessionFixture as WorkspaceCommands } from "./workspace-session-fixture.svelte";
	import WorkspaceSwitcher from "../ui/WorkspaceSwitcher.svelte";
	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const session = new WorkspaceCommands(desktop);
	const sessionQuery = createQuery(
		() => workspaceSessionQuery(session.desktop),
		() => session.queryClient
	);
	const catalogue = $derived(
		sessionQuery.data?.session.status === "ready" || sessionQuery.data?.session.status === "empty"
			? sessionQuery.data.session.catalogue
			: null
	);
	onDestroy(() => session.destroy());
	onMount(() => {
		void session.initialize();
	});
</script>

<WorkspaceSwitcher
	workspaces={catalogue?.workspaces ?? []}
	activeWorkspaceId={catalogue?.active_workspace_id ?? null}
	selectWorkspace={session.open}
	deleteWorkspace={session.deleteWorkspace}
	openCreationDialog={() => {}}
	disabled={session.isOperating}
	pendingOperation={session.pendingOperation}
/>
<p aria-label="Session status">{sessionQuery.data?.session.status}</p>
<p aria-label="Session warning">
	{sessionQuery.data?.session.status === "empty" ? sessionQuery.data.session.warning : ""}
</p>
<p aria-label="Workspace count">{catalogue?.workspaces.length ?? 0}</p>
<p aria-label="Pending operation">{session.pendingOperation ?? "none"}</p>
