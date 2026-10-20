<script lang="ts">
	import { createWorkspaceApp } from "$lib/app/workspace-app.svelte";
	import { setShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import WorkspaceCreationDialog from "$lib/modules/workspace/ui/WorkspaceCreationDialog.svelte";
	import * as Sidebar from "$lib/shared/ui/sidebar/index";
	import { Toaster } from "$lib/shared/ui/sonner";
	import { ModeWatcher } from "mode-watcher";
	import { untrack } from "svelte";
	import { QueryClientProvider } from "@tanstack/svelte-query";
	import type { LayoutProps } from "./$types";
	import "./layout.css";
	let { data, children }: LayoutProps = $props();

	setShortcutScope();
	const queryClient = untrack(() => data.queryClient);
	let creationDialogOpen = $state(false);
	const navigation = createWorkspaceApp(queryClient, () => {
		creationDialogOpen = true;
	});
</script>

<ModeWatcher defaultMode="system" disableHeadScriptInjection />
<Toaster position="top-center" />
<QueryClientProvider client={queryClient}>
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
</QueryClientProvider>
