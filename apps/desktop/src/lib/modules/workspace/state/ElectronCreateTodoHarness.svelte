<script lang="ts">
	import { onMount } from "svelte";
	import type { DesktopAPI } from "@tuxedo/contracts";
	import type { CreateTodoDraft } from "./workspace-commands.svelte";
	import { workspaceRouteFixture } from "./testing/workspace-route-fixture.svelte";

	type CreateTodoRequest = Parameters<DesktopAPI["createTodo"]>[0];
	type TodoOutcome = Awaited<ReturnType<DesktopAPI["createTodo"]>>;
	export type CreateTodoDesktop = DesktopAPI & {
		createTodo: (request: CreateTodoRequest) => Promise<TodoOutcome>;
	};

	let { desktop }: { desktop: CreateTodoDesktop } = $props();
	// svelte-ignore state_referenced_locally
	const fixture = workspaceRouteFixture(desktop);
	const session = fixture.commands;
	onMount(() => {
		void fixture.start();
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
<p aria-label="Pending target">
	{session.pendingTarget ? JSON.stringify(session.pendingTarget) : "none"}
</p>
<p aria-label="Action result">{result}</p>
