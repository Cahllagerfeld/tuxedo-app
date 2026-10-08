<script lang="ts">
	import type { DesktopAPI } from "$lib/shared/desktop/contract";
	import { ElectronWorkspaceSessionState } from "./electron-workspace-session.svelte";
	import TodoList from "$lib/modules/todo/ui/TodoList.svelte";
	import { summarizeTodoFile } from "$lib/modules/todo/domain/todo-file-summary";
	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const session = new ElectronWorkspaceSessionState(desktop);
	let result = $state("");
</script>

<p aria-label="Open count">{summarizeTodoFile(session.todoFile).counts.open}</p>
<p aria-label="Action result">{result}</p>
<button disabled={session.isOperating} onclick={() => session.restore()}>Restore</button>
{#if session.todoFile}<TodoList
		todoFile={session.todoFile}
		disabled={session.isOperating}
		onToggleComplete={async (todo) => {
			const outcome = await session.setCompletion(todo);
			result = outcome.status === "applied" ? "Applied" : outcome.message;
		}}
		onDelete={() => {}}
	/>{/if}
