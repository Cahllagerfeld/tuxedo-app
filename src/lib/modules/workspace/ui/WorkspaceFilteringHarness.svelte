<script lang="ts">
	import { onMount } from "svelte";
	import { createReaderState } from "$lib/app/reader-state.svelte";
	import type { DesktopAPI } from "$lib/shared/desktop/contract";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import { WorkspaceSessionFixture as WorkspaceCommands } from "../state/workspace-session-fixture.svelte";
	import WorkspaceContent from "./WorkspaceContent.svelte";
	import WorkspaceSidebar from "./sidebar/index.svelte";

	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const session: WorkspaceCommands = new WorkspaceCommands(desktop, () =>
		reader.todoFilter.reconcileSource()
	);
	const reader = createReaderState(session);
	onMount(() => void session.initialize());
</script>

<Sidebar.Provider class="flex h-128 min-h-0 overflow-hidden" style="--sidebar-width: 14rem;">
	<WorkspaceSidebar
		workspaces={session.catalogue?.workspaces ?? []}
		activeWorkspaceId={session.activeWorkspace?.id ?? null}
		todoSummary={reader.todos}
		todoFilter={reader.todoFilter}
		todoFileLoaded={session.todoFile !== null}
		collapsible="none"
		disabled={session.isOperating}
		pendingOperation={session.pendingOperation}
		selectWorkspace={session.open}
		deleteWorkspace={session.deleteWorkspace}
		openCreationDialog={() => {}}
	/>
	<Sidebar.Inset class="min-h-0 flex-1 overflow-hidden">
		<WorkspaceContent
			bulkSelection={reader.bulkSelection}
			workspace={session}
			todoFilter={reader.todoFilter}
			filteredTodoItems={reader.filteredTodoItems}
		/>
	</Sidebar.Inset>
</Sidebar.Provider>
