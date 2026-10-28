<script lang="ts">
	import { setSavedViews } from "#lib/modules/workspace/state/saved-views-resource.svelte.js";
	import { onMount } from "svelte";
	import type { DesktopAPI } from "@tuxedo/contracts";
	import * as Sidebar from "#lib/shared/ui/sidebar/index.js";
	import { workspaceFixture } from "./workspace-fixture.svelte";
	import { WorkspaceUiState } from "#lib/modules/workspace/ui/workspace-ui-state.svelte.js";
	import WorkspaceContent from "#lib/modules/workspace/ui/WorkspaceContent.svelte";
	import WorkspaceSidebar from "#lib/modules/workspace/ui/sidebar/index.svelte";

	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const fixture = workspaceFixture(desktop);
	const app = fixture.createApp();
	const ui = new WorkspaceUiState(app);
	setSavedViews(fixture.savedViews);
	onMount(() => {
		void fixture.start();
	});
</script>

<Sidebar.Provider class="flex h-128 min-h-0 overflow-hidden" style="--sidebar-width: 14rem;">
	<WorkspaceSidebar
		activeWorkspaceId={app.activeWorkspace?.id ?? null}
		todoSummary={app.todos}
		todoFilter={ui.todoFilter}
		todoFileLoaded={app.todoFile !== null}
		collapsible="none"
		disabled={app.workspace.isOperating || app.isLoading}
	/>
	<Sidebar.Inset class="min-h-0 flex-1 overflow-hidden">
		<WorkspaceContent
			bulkSelection={ui.bulkSelection}
			workspace={app.workspace}
			view={app}
			deleteWorkspace={app.navigation.deleteWorkspace}
			todoFilter={ui.todoFilter}
			filteredTodoItems={ui.filteredTodoItems}
			openWorkspaceCreationDialog={() => {}}
		/>
	</Sidebar.Inset>
</Sidebar.Provider>
