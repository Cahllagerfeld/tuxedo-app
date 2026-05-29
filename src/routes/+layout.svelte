<script lang="ts">
	import Sidebar from "@/modules/workspace/ui/sidebar/index.svelte";
	import WorkspaceHeader from "@/modules/workspace/ui/WorkspaceHeader.svelte";
	import WorkspaceStatusBar from "@/modules/workspace/ui/WorkspaceStatusBar.svelte";
	import WorkspaceViewToggler from "@/modules/workspace/ui/WorkspaceViewToggler.svelte";
	import { setAppState } from "@/app/app-context";
	import { AppState } from "@/app/app-state.svelte";
	import * as Resizable from "@/shared/ui/resizable/index";
	import { onMount } from "svelte";
	import "./layout.css";
	import { ScrollArea } from "@/shared/ui/scroll-area";
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
			<Resizable.Pane maxSize={30} minSize={10} defaultSize={10}>
				<Sidebar />
			</Resizable.Pane>
			<Resizable.Handle withHandle />
			<Resizable.Pane>
				<div class="flex h-full flex-col overflow-hidden">
					<ScrollArea class="min-h-0 flex-1">
						{@render children()}
					</ScrollArea>
				</div>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	</main>
	<WorkspaceStatusBar />
</div>
