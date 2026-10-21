<script lang="ts">
	import { onMount } from "svelte";
	import { AppState } from "./app-state.svelte";
	import AppNavbar from "./AppNavbar.svelte";
	import { ElectronWorkspaceSessionState } from "$lib/modules/workspace/state/electron-workspace-session.svelte";
	import type { DesktopAPI } from "@tuxedo/contracts";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import { setShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import { Toaster } from "$lib/shared/ui/sonner";
	import "../../routes/layout.css";
	let { desktop }: { desktop: DesktopAPI } = $props();
	setShortcutScope();
	// svelte-ignore state_referenced_locally
	const app = new AppState(new ElectronWorkspaceSessionState(desktop));
	onMount(() => {
		void app.workspace.initialize();
	});
</script>

<Sidebar.Provider>
	<AppNavbar {app} />
</Sidebar.Provider>
<button onclick={() => app.workspace.createTodo({ description: "New", projects: [], contexts: [] })}
	>Create item</button
>
<button onclick={() => app.workspace.restore()}>Refresh</button>
<p aria-label="Item count">{app.workspace.todoFile?.items.length ?? 0}</p>
<input aria-label="Draft" />
<Toaster />
