<script lang="ts">
	import { onMount } from "svelte";
	import { AppState } from "$lib/app/app-state.svelte";
	import type { DesktopAPI } from "$lib/shared/desktop/contract";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";
	import WorkspaceContent from "./WorkspaceContent.svelte";
	import WorkspaceSidebar from "./sidebar/index.svelte";

	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const app = new AppState(new ElectronWorkspaceSessionState(desktop));
	onMount(() => void app.workspace.initialize());
</script>

<!-- Drive confirmed session changes independently of routing in filter integration tests. -->
{#each app.workspace.catalogue?.workspaces ?? [] as saved (saved.id)}
	<button onclick={() => app.workspace.open(saved.id)}>Confirm Workspace {saved.name}</button>
{/each}

<Sidebar.Provider class="flex h-128 min-h-0 overflow-hidden" style="--sidebar-width: 14rem;">
	<WorkspaceSidebar
		workspaces={app.workspace.catalogue?.workspaces ?? []}
		activeWorkspaceId={app.workspace.activeWorkspace?.id ?? null}
		todoSummary={app.todos}
		todoFilter={app.todoFilter}
		todoFileLoaded={app.workspace.todoFile !== null}
		collapsible="none"
		disabled={app.workspace.isOperating || app.workspace.isLoading}
		pendingOperation={app.workspace.pendingOperation}
		deleteWorkspace={app.workspace.deleteWorkspace}
		openCreationDialog={() => {}}
	/>
	<Sidebar.Inset class="min-h-0 flex-1 overflow-hidden">
		{#if app.workspace.todoFile}
			<WorkspaceContent
				bulkSelection={app.bulkSelection}
				workspace={app.workspace}
				todoFilter={app.todoFilter}
				filteredTodoItems={app.filteredTodoItems}
			/>
		{/if}
	</Sidebar.Inset>
</Sidebar.Provider>
