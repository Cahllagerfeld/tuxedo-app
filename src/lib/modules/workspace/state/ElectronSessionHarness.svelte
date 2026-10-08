<script lang="ts">
	import type { DesktopAPI } from "$lib/shared/desktop/contract";
	import { ElectronWorkspaceSessionState } from "./electron-workspace-session.svelte";
	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const session = new ElectronWorkspaceSessionState(desktop);
</script>

<p aria-label="Session status">{session.session.status}</p>
<p aria-label="Session warning">{session.warning}</p>
<button disabled={session.isOperating} onclick={() => session.restore()}>Restore</button>
<p aria-label="Pending operation">{session.pendingOperation ?? "none"}</p>
