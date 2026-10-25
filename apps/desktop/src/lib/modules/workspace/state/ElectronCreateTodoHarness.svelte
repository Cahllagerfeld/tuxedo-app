<script lang="ts">
	import { onMount } from "svelte";
	import type { DesktopAPI } from "@tuxedo/contracts";
	import type { CreateTodoDraft } from "./workspace-commands.svelte";
	import { workspaceFixture } from "./testing/workspace-fixture.svelte";

	type CreateTodoRequest = Parameters<DesktopAPI["createTodo"]>[0];
	type TodoOutcome = Awaited<ReturnType<DesktopAPI["createTodo"]>>;
	export type CreateTodoDesktop = DesktopAPI & {
		createTodo: (request: CreateTodoRequest) => Promise<TodoOutcome>;
	};

	let { desktop }: { desktop: CreateTodoDesktop } = $props();
	// svelte-ignore state_referenced_locally
	const fixture = workspaceFixture(desktop);
	const session = fixture.commands;
	const app = fixture.createApp();
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

<p aria-label="Session status">{app.session.status}</p>
<button disabled={session.isOperating} onclick={create}>Create</button>
<p aria-label="Item count">{app.todoFile?.items.length ?? 0}</p>
<p aria-label="Pending operation">{session.pendingOperation ?? "none"}</p>
<p aria-label="Pending target">
	{session.pendingTarget ? JSON.stringify(session.pendingTarget) : "none"}
</p>
<p aria-label="Action result">{result}</p>
