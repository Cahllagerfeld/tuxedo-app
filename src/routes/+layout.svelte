<script lang="ts">
	import { setAppState } from "@/app/app-context";
	import { AppState } from "@/app/app-state.svelte";
	import AppHeader from "@/app/AppHeader.svelte";
	import ReaderStatusBar from "@/app/ReaderStatusBar.svelte";
	import Sidebar from "@/modules/workspace/ui/sidebar/index.svelte";
	import WorkspaceCreationDialog from "@/modules/workspace/ui/WorkspaceCreationDialog.svelte";
	import * as Resizable from "@/shared/ui/resizable/index";
	import { ScrollArea } from "@/shared/ui/scroll-area";
	import { Toaster } from "@/shared/ui/sonner";
	import { onMount } from "svelte";
	import "./layout.css";
	import { createTodoFileObservationAdapter } from "$lib/modules/todo/api/todo-file-observation-api";
	import { showTodoFileObservationNotice } from "$lib/modules/todo/ui/todo-file-notices";
	let { children } = $props();

	const appState = new AppState(undefined, undefined, createTodoFileObservationAdapter(), {
		onObservationSummaryChanged: showTodoFileObservationNotice,
	});
	setAppState(appState);

	onMount(() => {
		void appState.restore();
	});
</script>

<Toaster position="top-center" />
<div class="flex h-dvh flex-col overflow-hidden font-medium antialiased">
	<AppHeader />
	<main class="flex min-h-0 flex-1 overflow-hidden">
		<Resizable.PaneGroup direction="horizontal">
			<Resizable.Pane maxSize={30} minSize={12} defaultSize={15}>
				<Sidebar
					workspaces={appState.workspace.catalogue?.workspaces ?? []}
					activeWorkspaceId={appState.workspace.activeWorkspace?.id ?? null}
					disabled={appState.workspace.isOperating || appState.workspace.isLoading}
					selectWorkspace={appState.open}
					deleteWorkspace={appState.delete}
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
		disabled={appState.workspace.isOperating || appState.workspace.isLoading}
		createWorkspace={appState.create}
	/>
	<ReaderStatusBar
		activeWorkspace={appState.workspace.activeWorkspace}
		todoFile={appState.workspace.todoFile}
		todoSummary={appState.todos}
	/>
</div>
