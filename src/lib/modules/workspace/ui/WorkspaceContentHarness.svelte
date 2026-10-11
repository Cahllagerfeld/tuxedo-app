<script lang="ts">
	import { onMount } from "svelte";
	import type { DesktopAPI, TodoFileObservation } from "$lib/shared/desktop/contract";
	import { toast } from "svelte-sonner";
	import { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";
	import { AppState } from "$lib/app/app-state.svelte";
	import ReaderStatusBar from "$lib/app/ReaderStatusBar.svelte";
	import WorkspaceContent from "./WorkspaceContent.svelte";
	import { Toaster } from "$lib/shared/ui/sonner";
	let { desktop, observation }: { desktop: DesktopAPI; observation?: TodoFileObservation } =
		$props();
	// svelte-ignore state_referenced_locally
	const app = new AppState(new ElectronWorkspaceSessionState(desktop));
	onMount(() => {
		const stop =
			observation && app.workspace.observe(observation, () => toast.info("Todo file reloaded"));
		void app.workspace.initialize();
		return stop;
	});
</script>

<Toaster />
<p aria-label="Summary counts">
	{app.todos.counts.open}/{app.todos.counts.completed}/{app.todos.counts.projects}
</p>
<p aria-label="Summary facets">{app.todos.facets.projects.join(",")}</p>
<div class="flex h-96 flex-col">
	<WorkspaceContent
		workspace={app.workspace}
		todoFilter={app.todoFilter}
		filteredTodoItems={app.filteredTodoItems}
		openWorkspaceCreationDialog={() => {}}
	/>
</div>
<ReaderStatusBar
	activeWorkspace={app.workspace.activeWorkspace}
	todoFile={app.workspace.todoFile}
	todoSummary={app.todos}
	pendingOperation={app.workspace.pendingOperation}
/>
