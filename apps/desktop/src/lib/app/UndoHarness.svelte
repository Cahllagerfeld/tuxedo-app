<script lang="ts">
	import { onMount } from "svelte";
	import { AppState } from "./app-state.svelte";
	import AppNavbar from "./AppNavbar.svelte";
	import { workspaceRouteFixture } from "#lib/modules/workspace/state/testing/workspace-route-fixture.svelte.js";
	import type { DesktopAPI } from "@tuxedo/contracts";
	import * as Sidebar from "#lib/shared/ui/sidebar/index.js";
	import { setShortcutScope } from "#lib/shared/shortcuts/shortcut-scope.svelte.js";
	import { Toaster } from "#lib/shared/ui/sonner/index.js";
	import "../../routes/layout.css";
	let { desktop }: { desktop: DesktopAPI } = $props();
	setShortcutScope();
	// svelte-ignore state_referenced_locally
	const fixture = workspaceRouteFixture(desktop);
	const app = new AppState(fixture.commands);
	onMount(() => {
		void fixture.start();
	});
</script>

<Sidebar.Provider>
	<AppNavbar {app} />
</Sidebar.Provider>
<button onclick={() => app.workspace.createTodo({ description: "New", projects: [], contexts: [] })}
	>Create item</button
>
<button onclick={() => fixture.reload()}>Refresh</button>
<p aria-label="Item count">{app.workspace.todoFile?.items.length ?? 0}</p>
<input aria-label="Draft" />
<Toaster />
