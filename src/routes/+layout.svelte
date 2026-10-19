<script lang="ts">
	import { setWorkspaceContext } from "@/app/app-context";
	import { createReaderState } from "@/app/reader-state.svelte";
	import { setShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import WorkspaceCreationDialog from "@/modules/workspace/ui/WorkspaceCreationDialog.svelte";
	import * as Sidebar from "@/shared/ui/sidebar/index";
	import { Toaster } from "@/shared/ui/sonner";
	import { ModeWatcher } from "mode-watcher";
	import { navigating } from "$app/state";
	import { afterNavigate, invalidate } from "$app/navigation";
	import { WorkspaceCommands } from "$lib/modules/workspace/state/workspace-commands.svelte";
	import { sessionDependency, viewsDependency } from "$lib/modules/workspace/state/workspace-load";
	import { createWorkspaceNavigation } from "@/app/workspace-navigation.svelte";
	import type { LayoutProps } from "./$types";
	import "./layout.css";
	let { data, children }: LayoutProps = $props();

	setShortcutScope();
	const workspace: WorkspaceCommands = new WorkspaceCommands(
		window.desktop,
		() => ({ ...data.sessionData, ...data.viewsData }),
		async (dependency) => {
			await navigation.refresh(() =>
				invalidate(
					(url) =>
						(dependency !== "views" && url.href === sessionDependency) ||
						(dependency !== "session" && url.href === viewsDependency)
				)
			);
			reader.todoFilter.reconcileSource();
		},
		() => !!navigating.to
	);
	const reader = createReaderState(workspace);
	afterNavigate((event) => {
		if (event.from?.params?.id !== event.to?.params?.id)
			void event.complete.then(() => {
				reader.creationOpen = false;
				reader.bulkSelection.exit();
			});
	});
	const navigation = createWorkspaceNavigation(workspace);
	let creationDialogOpen = $state(false);
	const openWorkspaceCreationDialog = () => {
		creationDialogOpen = true;
	};
	setWorkspaceContext({ workspace, reader, navigation, openWorkspaceCreationDialog });
</script>

<!-- app.html sets the initial theme; ModeWatcher follows system changes after mount. -->
<ModeWatcher defaultMode="system" disableHeadScriptInjection />
<Toaster position="top-center" />
<Sidebar.Provider
	class="flex h-dvh min-h-0 flex-col overflow-hidden bg-window-background font-normal antialiased"
	style="--window-toolbar-height: 2.5rem; --sidebar-width: 16rem;"
	data-sveltekit-preload-data={navigation.busy ? "off" : "hover"}
>
	{@render children()}
	<WorkspaceCreationDialog
		bind:open={creationDialogOpen}
		disabled={navigation.busy}
		createWorkspace={navigation.createWorkspace}
	/>
</Sidebar.Provider>
