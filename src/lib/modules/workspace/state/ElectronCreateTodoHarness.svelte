<script lang="ts">
	import { onMount } from "svelte";
	import type { DesktopAPI } from "$lib/shared/desktop/contract";
	import { WorkspaceSessionFixture as WorkspaceCommands } from "./workspace-session-fixture.svelte";
	import type { CreateTodoDraft } from "./workspace-commands.svelte";

	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const session = new WorkspaceCommands(desktop);
	onMount(() => {
		void session.initialize();
	});
	let result = $state("");
	const draft: CreateTodoDraft = {
		description: "Plan launch",
		projects: ["Work"],
		contexts: ["Office"],
	};
	async function create() {
		const outcome = await session.createTodo(draft);
		result = outcome.status === "applied" ? "Applied" : outcome.message;
	}
</script>

<p aria-label="Session status">{session.session.status}</p>
<button disabled={session.isOperating} onclick={create}>Create</button>
<p aria-label="Item count">{session.todoFile?.items.length ?? 0}</p>
<p aria-label="Pending operation">{session.pendingOperation ?? "none"}</p>
<p aria-label="Action result">{result}</p>
