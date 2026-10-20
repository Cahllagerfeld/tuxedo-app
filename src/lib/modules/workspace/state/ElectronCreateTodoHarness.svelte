<script lang="ts">
	import { createQuery } from "@tanstack/svelte-query";
	import { workspaceSessionQuery } from "$lib/modules/workspace/state/workspace-queries";
	import { onDestroy, onMount } from "svelte";
	import type { DesktopAPI } from "$lib/shared/desktop/contract";
	import { WorkspaceSessionFixture as WorkspaceCommands } from "./workspace-session-fixture.svelte";
	import type { CreateTodoDraft } from "./workspace-commands.svelte";

	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const session = new WorkspaceCommands(desktop);
	const sessionQuery = createQuery(
		() => workspaceSessionQuery(session.desktop),
		() => session.queryClient
	);
	const todoFile = $derived(
		sessionQuery.data?.session.status === "ready" ? sessionQuery.data.session.todo_file : null
	);

	onDestroy(() => session.destroy());
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

<p aria-label="Session status">{sessionQuery.data?.session.status}</p>
<button disabled={session.isOperating} onclick={create}>Create</button>
<p aria-label="Item count">{todoFile?.items.length ?? 0}</p>
<p aria-label="Pending operation">{session.pendingOperation ?? "none"}</p>
<p aria-label="Action result">{result}</p>
