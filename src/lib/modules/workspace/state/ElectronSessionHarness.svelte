<script lang="ts">
	import { summarizeTodoFile } from "$lib/modules/todo/domain/todo-file-summary";
	import type { DesktopAPI } from "$lib/shared/desktop/contract";
	import { ElectronWorkspaceSessionState } from "./electron-workspace-session.svelte";
	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const session = new ElectronWorkspaceSessionState(desktop);
	let result = $state("");
	async function create() {
		const outcome = await session.create({
			name: "Personal",
			color: "blue",
			todoPath: "/tmp/todo.txt",
		});
		result = outcome.status === "applied" ? "Applied" : outcome.message;
	}
</script>

<p aria-label="Session status">{session.session.status}</p>
<p aria-label="Session warning">{session.warning}</p>
<button disabled={session.isOperating} onclick={() => session.restore()}>Restore</button>
<p aria-label="Pending operation">{session.pendingOperation ?? "none"}</p>

<button disabled={session.isOperating} onclick={create}>Create</button>
<p aria-label="Item count">{summarizeTodoFile(session.todoFile).counts.total}</p>
<p aria-label="Active workspace">{session.activeWorkspace?.name}</p>

<p aria-label="Action result">{result}</p>
