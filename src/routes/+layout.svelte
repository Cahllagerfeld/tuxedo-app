<script lang="ts">
	import Sidebar from "@/components/Sidebar.svelte";
	import WorkspaceHeader from "@/components/workspace/WorkspaceHeader.svelte";
	import WorkspaceStatusBar from "@/components/workspace/WorkspaceStatusBar.svelte";
	import WorkspaceViewToggler from "@/components/workspace/WorkspaceViewToggler.svelte";
	import { setAppState } from "@/state/app-context";
	import { AppState } from "@/state/app-state.svelte";
	import { onMount } from "svelte";
	import "./layout.css";
	let { children } = $props();

	const appState = new AppState();
	setAppState(appState);

	onMount(() => {
		void appState.workspace.restore();
	});
</script>

<div class="h-dvh flex flex-col font-medium antialiased overflow-hidden">
	<WorkspaceHeader />
	<WorkspaceViewToggler />
	<main class="flex min-h-0 flex-1 overflow-hidden">
		<Sidebar />
		{@render children()}
	</main>
	<WorkspaceStatusBar />
</div>
