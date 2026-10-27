<script lang="ts">
	import { onMount } from "svelte";
	import AppNavbar from "./AppNavbar.svelte";
	import { workspaceFixture } from "#lib/modules/workspace/state/testing/workspace-fixture.svelte.js";
	import { WorkspaceUiState } from "#lib/modules/workspace/ui/workspace-ui-state.svelte.js";
	import type { DesktopAPI } from "@tuxedo/contracts";
	import * as Sidebar from "#lib/shared/ui/sidebar/index.js";
	import { setShortcutScope } from "#lib/shared/shortcuts/shortcut-scope.svelte.js";
	import { Toaster } from "#lib/shared/ui/sonner/index.js";
	import "../../routes/layout.css";
	let { desktop }: { desktop: DesktopAPI } = $props();
	setShortcutScope();
	// svelte-ignore state_referenced_locally
	const fixture = workspaceFixture(desktop);
	const app = fixture.createApp();
	const ui = new WorkspaceUiState(app);
	onMount(() => {
		void fixture.start();
	});
</script>

<Sidebar.Provider>
	<AppNavbar {app} {ui} />
</Sidebar.Provider>
<button onclick={() => app.workspace.createTodo({ description: "New", projects: [], contexts: [] })}
	>Create item</button
>
<button onclick={() => fixture.reload()}>Refresh</button>
<p aria-label="Item count">{app.todoFile?.items.length ?? 0}</p>
<input aria-label="Draft" />
<Toaster />
