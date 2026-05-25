<script lang="ts">
	import Sidebar from "@/components/Sidebar.svelte";
	import WorkspaceHeader from "@/components/workspace/WorkspaceHeader.svelte";
	import WorkspaceStatusBar from "@/components/workspace/WorkspaceStatusBar.svelte";
	import WorkspaceViewToggler from "@/components/workspace/WorkspaceViewToggler.svelte";
	import { setAppState } from "@/state/app-context";
	import { AppState } from "@/state/app-state.svelte";
	import * as Resizable from "@/components/ui/resizable/index";
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
		<Resizable.PaneGroup direction="horizontal">
			<Resizable.Pane maxSize={40} minSize={10} defaultSize={10}>
				<Sidebar />
			</Resizable.Pane>
			<Resizable.Handle withHandle />
			<Resizable.Pane>
				{@render children()}
			</Resizable.Pane>
		</Resizable.PaneGroup>
	</main>
	<WorkspaceStatusBar />
</div>
