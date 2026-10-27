<script lang="ts">
	import { onMount } from "svelte";
	import type { DesktopAPI } from "@tuxedo/contracts";
	import { workspaceFixture } from "./workspace-fixture.svelte";
	import WorkspaceSwitcher from "#lib/modules/workspace/ui/WorkspaceSwitcher.svelte";
	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const fixture = workspaceFixture(desktop);
	const session = fixture.commands;
	const app = fixture.createApp();
	onMount(() => {
		void fixture.start();
	});
</script>

<WorkspaceSwitcher
	workspaces={app.catalogue?.workspaces ?? []}
	activeWorkspaceId={app.catalogue?.active_workspace_id ?? null}
	selectWorkspace={fixture.navigate}
	deleteWorkspace={app.navigation.deleteWorkspace}
	openCreationDialog={() => {}}
	disabled={session.isOperating}
	pendingOperation={session.pendingOperation}
/>
<p aria-label="Session status">{app.session.status}</p>
<p aria-label="Session warning">
	{app.navigation.destinationError || (app.session.status === "empty" ? app.session.warning : "")}
</p>
<p aria-label="Workspace count">{app.catalogue?.workspaces.length ?? 0}</p>
<p aria-label="Pending operation">{session.pendingOperation ?? "none"}</p>
