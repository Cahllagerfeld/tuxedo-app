<script lang="ts">
	import type { DesktopAPI } from "$lib/shared/desktop/contract";
	import { ElectronWorkspaceSessionState } from "./electron-workspace-session.svelte";
	import WorkspaceSwitcher from "../ui/WorkspaceSwitcher.svelte";
	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const session = new ElectronWorkspaceSessionState(desktop);
</script>

<WorkspaceSwitcher
	workspaces={session.catalogue?.workspaces ?? []}
	activeWorkspaceId={session.catalogue?.active_workspace_id ?? null}
	selectWorkspace={session.open}
	deleteWorkspace={session.deleteWorkspace}
	openCreationDialog={() => {}}
	disabled={session.isOperating}
	pendingOperation={session.pendingOperation}
/>
<p aria-label="Session status">{session.session.status}</p>
<p aria-label="Session warning">{session.warning}</p>
<p aria-label="Workspace count">{session.catalogue?.workspaces.length ?? 0}</p>
<p aria-label="Pending operation">{session.pendingOperation ?? "none"}</p>
