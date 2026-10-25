<script lang="ts">
	import { setSavedViews } from "../state/saved-views-resource.svelte";
	import { onMount } from "svelte";
	import type { DesktopAPI } from "@tuxedo/contracts";
	import * as Sidebar from "#lib/shared/ui/sidebar/index.js";
	import { workspaceFixture } from "../state/testing/workspace-fixture.svelte";
	import WorkspaceContent from "./WorkspaceContent.svelte";
	import WorkspaceSidebar from "./sidebar/index.svelte";

	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const fixture = workspaceFixture(desktop);
	const app = fixture.createApp();
	setSavedViews(fixture.savedViews);
	onMount(() => {
		void fixture.start();
	});
</script>

<Sidebar.Provider class="flex h-128 min-h-0 overflow-hidden" style="--sidebar-width: 14rem;">
	<WorkspaceSidebar
		workspaces={app.catalogue?.workspaces ?? []}
		activeWorkspaceId={app.activeWorkspace?.id ?? null}
		todoSummary={app.todos}
		todoFilter={app.todoFilter}
		todoFileLoaded={app.todoFile !== null}
		collapsible="none"
		disabled={app.workspace.isOperating || app.isLoading}
		pendingOperation={app.workspace.pendingOperation}
		selectWorkspace={fixture.navigate}
		deleteWorkspace={app.navigation.deleteWorkspace}
		openCreationDialog={() => {}}
	/>
	<Sidebar.Inset class="min-h-0 flex-1 overflow-hidden">
		<WorkspaceContent
			bulkSelection={app.bulkSelection}
			workspace={app.workspace}
			view={app}
			deleteWorkspace={app.navigation.deleteWorkspace}
			todoFilter={app.todoFilter}
			filteredTodoItems={app.filteredTodoItems}
			openWorkspaceCreationDialog={() => {}}
		/>
	</Sidebar.Inset>
</Sidebar.Provider>
