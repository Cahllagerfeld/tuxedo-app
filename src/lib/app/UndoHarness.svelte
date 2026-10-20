<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import AppNavbar from "./AppNavbar.svelte";
	import { WorkspaceSessionFixture as WorkspaceCommands } from "$lib/modules/workspace/state/workspace-session-fixture.svelte";
	import type { DesktopAPI } from "$lib/shared/desktop/contract";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import { setShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import { Toaster } from "$lib/shared/ui/sonner";
	import "../../routes/layout.css";
	let { desktop }: { desktop: DesktopAPI } = $props();
	setShortcutScope();
	// svelte-ignore state_referenced_locally
	const session = new WorkspaceCommands(desktop);
	onDestroy(() => session.destroy());
	onMount(() => {
		void session.initialize();
	});
</script>

<Sidebar.Provider>
	<AppNavbar
		workspace={session.data}
		commands={session}
		bulkSelectionActive={false}
		openWorkspaceSwitcher={() => {}}
		openWorkspaceCreationDialog={() => {}}
		openTodoCreation={() => {}}
	/>
</Sidebar.Provider>
<button onclick={() => session.createTodo({ description: "New", projects: [], contexts: [] })}
	>Create item</button
>
<button onclick={() => session.restore()}>Refresh</button>
<p aria-label="Item count">{session.todoFile?.items.length ?? 0}</p>
<input aria-label="Draft" />
<Toaster />
