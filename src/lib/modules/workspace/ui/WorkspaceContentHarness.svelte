<script lang="ts">
	import { onMount } from "svelte";
	import type { DesktopAPI } from "$lib/shared/desktop/contract";
	import { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";
	import { AppState } from "$lib/app/app-state.svelte";
	import WorkspaceContent from "./WorkspaceContent.svelte";
	import { Toaster } from "$lib/shared/ui/sonner";
	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const app = new AppState(new ElectronWorkspaceSessionState(desktop));
	onMount(() => {
		void app.workspace.initialize();
	});
</script>

<Toaster />
<p aria-label="Summary counts">
	{app.todos.counts.open}/{app.todos.counts.completed}/{app.todos.counts.projects}
</p>
<p aria-label="Summary facets">{app.todos.facets.projects.join(",")}</p>
<WorkspaceContent workspace={app.workspace} openWorkspaceCreationDialog={() => {}} />
