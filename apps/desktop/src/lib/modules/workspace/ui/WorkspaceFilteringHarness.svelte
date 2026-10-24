<script lang="ts">
	import { SavedViewsResource, setSavedViews } from "../state/saved-views-resource.svelte";
	import { readSavedViews, type SavedViewsData } from "../state/saved-views";
	import { onMount } from "svelte";
	import { AppState } from "#lib/app/app-state.svelte.js";
	import type { DesktopAPI } from "@tuxedo/contracts";
	import * as Sidebar from "#lib/shared/ui/sidebar/index.js";
	import { workspaceRouteFixture } from "../state/testing/workspace-route-fixture.svelte";
	import WorkspaceContent from "./WorkspaceContent.svelte";
	import WorkspaceSidebar from "./sidebar/index.svelte";

	let { desktop }: { desktop: DesktopAPI } = $props();
	// svelte-ignore state_referenced_locally
	const fixture = workspaceRouteFixture(desktop);
	const app = new AppState(fixture.commands);
	let routeData = $state.raw<SavedViewsData>();
	async function refreshViews(workspaceId: string) {
		routeData = await readSavedViews(desktop, workspaceId, () => routeData);
	}
	// svelte-ignore state_referenced_locally
	setSavedViews(new SavedViewsResource(desktop, app.workspace, () => routeData, refreshViews));
	onMount(() => {
		void fixture.start().then(() => {
			const id = app.workspace.activeWorkspace?.id;
			if (id) return refreshViews(id);
		});
	});
</script>

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
		selectWorkspace={fixture.navigate}
		deleteWorkspace={app.workspace.deleteWorkspace}
		openCreationDialog={() => {}}
	/>
	<Sidebar.Inset class="min-h-0 flex-1 overflow-hidden">
		<WorkspaceContent
			bulkSelection={app.bulkSelection}
			workspace={app.workspace}
			todoFilter={app.todoFilter}
			filteredTodoItems={app.filteredTodoItems}
			openWorkspaceCreationDialog={() => {}}
		/>
	</Sidebar.Inset>
</Sidebar.Provider>
