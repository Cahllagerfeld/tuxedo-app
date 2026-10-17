<script lang="ts">
	import { onMount } from "svelte";
	import { AppState } from "./app-state.svelte";
	import AppNavbar from "./AppNavbar.svelte";
	import { WorkspaceSessionFixture as ElectronWorkspaceSessionState } from "$lib/modules/workspace/state/workspace-session-fixture.svelte";
	import type { DesktopAPI } from "$lib/shared/desktop/contract";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import { setShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import { Toaster } from "$lib/shared/ui/sonner";
	import "../../routes/layout.css";
	let { desktop, readerAvailable = true }: { desktop: DesktopAPI; readerAvailable?: boolean } =
		$props();
	setShortcutScope();
	// svelte-ignore state_referenced_locally
	const session = new ElectronWorkspaceSessionState(desktop);
	const app = new AppState(session);
	onMount(() => {
		void session.initialize();
	});
</script>

<Sidebar.Provider>
	<AppNavbar {app} {readerAvailable} />
</Sidebar.Provider>
<button onclick={() => app.workspace.createTodo({ description: "New", projects: [], contexts: [] })}
	>Create item</button
>
<button onclick={() => app.workspace.restore()}>Refresh</button>
<p aria-label="Item count">{app.workspace.todoFile?.items.length ?? 0}</p>
<input aria-label="Draft" />
<p aria-label="Creation open">{String(app.isTodoCreationOpen)}</p>
<Toaster />
