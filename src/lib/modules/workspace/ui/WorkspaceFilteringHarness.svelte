<script lang="ts">
	import { createQuery } from "@tanstack/svelte-query";
	import { workspaceSessionQuery } from "$lib/modules/workspace/state/workspace-queries";
	import { onDestroy, onMount } from "svelte";
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
	const sessionQuery = createQuery(
		() => workspaceSessionQuery(session.desktop),
		() => session.queryClient
	);
	const catalogue = $derived(
		sessionQuery.data?.session.status === "ready" || sessionQuery.data?.session.status === "empty"
			? sessionQuery.data.session.catalogue
			: null
	);
	const workspace = $derived(
		catalogue?.workspaces.find((item) => item.id === catalogue.active_workspace_id) ?? null
	);
	const todoFile = $derived(
		sessionQuery.data?.session.status === "ready" ? sessionQuery.data.session.todo_file : null
	);
	const reader = createReaderState(
		() => workspace,
		() => todoFile,
		session
	);
	onDestroy(() => session.destroy());
	onMount(() => void session.initialize());
</script>

<Sidebar.Provider class="flex h-128 min-h-0 overflow-hidden" style="--sidebar-width: 14rem;">
	<WorkspaceSidebar
		workspaces={catalogue?.workspaces ?? []}
		activeWorkspaceId={workspace?.id ?? null}
		todoSummary={reader.todos}
		todoFilter={reader.todoFilter}
		todoFileLoaded={todoFile !== null}
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
			{workspace}
			{todoFile}
			commands={session}
			todoFilter={reader.todoFilter}
			filteredTodoItems={reader.filteredTodoItems}
		/>
	</Sidebar.Inset>
</Sidebar.Provider>
