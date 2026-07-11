<script lang="ts">
	import AppHeader from "@/app/AppHeader.svelte";
	import Sidebar from "@/modules/workspace/ui/sidebar/index.svelte";
	import WorkspaceCreationDialog from "@/modules/workspace/ui/WorkspaceCreationDialog.svelte";
	import WorkspaceStatusBar from "@/modules/workspace/ui/WorkspaceStatusBar.svelte";
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
	<AppHeader />
	<main class="flex min-h-0 flex-1 overflow-hidden">
		<Resizable.PaneGroup direction="horizontal">
			<Resizable.Pane maxSize={30} minSize={12} defaultSize={15}>
				<Sidebar
					workspaces={appState.workspace.catalogue?.workspaces ?? []}
					activeWorkspaceId={appState.workspace.activeWorkspace?.id ?? null}
					disabled={appState.workspace.isOperating}
					selectWorkspace={appState.workspace.open}
					deleteWorkspace={appState.workspace.delete}
					openCreationDialog={appState.openWorkspaceCreationDialog}
				/>
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
	<WorkspaceCreationDialog
		bind:open={appState.isWorkspaceCreationDialogOpen}
		disabled={appState.workspace.isOperating}
		createWorkspace={appState.workspace.create}
	/>
	<WorkspaceStatusBar />
</div>
