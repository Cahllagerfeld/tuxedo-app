<script lang="ts">
	import { setAppState } from "@/app/app-context";
	import { AppState } from "@/app/app-state.svelte";
	import { setShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import AppNavbar from "@/app/AppNavbar.svelte";
	import ReaderStatusBar from "@/app/ReaderStatusBar.svelte";
	import WorkspaceSidebar from "@/modules/workspace/ui/sidebar/index.svelte";
	import WorkspaceCreationDialog from "@/modules/workspace/ui/WorkspaceCreationDialog.svelte";
	import * as Sidebar from "@/shared/ui/sidebar/index";
	import { Toaster } from "@/shared/ui/sonner";
	import { ModeWatcher } from "mode-watcher";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { beforeNavigate, goto, onNavigate } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import type { DesktopRequest } from "$lib/shared/desktop/contract";
	import "./layout.css";
	let { children } = $props();

	setShortcutScope();
	const appState = new AppState();
	setAppState(appState);
	const busy = $derived(appState.workspace.isOperating || appState.workspace.isLoading);
	const showsActiveWorkspace = $derived(appState.shows(page.params.id));
	const openWorkspace = (id: string, replaceState = false) =>
		goto(resolve("/workspaces/[id]", { id }), { replaceState });

	// Routing must not race an admitted operation; closing or reloading the window stays allowed.
	beforeNavigate((navigation) => {
		if (busy && navigation.type !== "leave") navigation.cancel();
	});
	onNavigate(({ to }) => {
		if (to?.params?.id) appState.visitWorkspace(to.params.id);
	});

	async function createWorkspace(input: DesktopRequest<"createWorkspace">) {
		const outcome = await appState.workspace.create(input);
		const created = appState.workspace.activeWorkspace;
		if (outcome.status === "applied" && created) await openWorkspace(created.id);
		return outcome;
	}

	onMount(() => {
		const stop = appState.workspace.observe(window.desktop, () => toast.info("Todo file reloaded"));
		void appState.workspace.initialize().then(() => {
			const active = appState.workspace.activeWorkspace;
			if (page.params.id) appState.visitWorkspace(page.params.id);
			else if (active && appState.workspace.todoFile) void openWorkspace(active.id, true);
		});
		return stop;
	});
</script>

<!-- app.html sets the initial theme; ModeWatcher follows system changes after mount. -->
<ModeWatcher defaultMode="system" disableHeadScriptInjection />
<Toaster position="top-center" />
<Sidebar.Provider
	class="flex h-dvh min-h-0 flex-col overflow-hidden bg-window-background font-normal antialiased"
	style="--window-toolbar-height: 2.5rem; --sidebar-width: 16rem;"
>
	<AppNavbar app={appState} readerShown={showsActiveWorkspace} />
	<div
		data-slot="app-inset"
		class="relative m-1 flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-background shadow-sm"
	>
		<WorkspaceSidebar
			bind:switcherOpen={appState.isWorkspaceSwitcherOpen}
			workspaces={appState.workspace.catalogue?.workspaces ?? []}
			activeWorkspaceId={appState.workspace.activeWorkspace?.id ?? null}
			todoSummary={appState.todos}
			todoFilter={appState.todoFilter}
			todoFileLoaded={showsActiveWorkspace && appState.workspace.todoFile !== null}
			disabled={busy}
			pendingOperation={appState.workspace.pendingOperation}
			selectWorkspace={(id) => void openWorkspace(id)}
			deleteWorkspace={appState.workspace.deleteWorkspace}
			openCreationDialog={appState.openWorkspaceCreationDialog}
		/>
		<main data-slot="app-content" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			{@render children()}
			{#if showsActiveWorkspace}
				<ReaderStatusBar
					activeWorkspace={appState.workspace.activeWorkspace}
					todoFile={appState.workspace.todoFile}
					todoSummary={appState.todos}
					pendingOperation={appState.workspace.pendingOperation}
				/>
			{/if}
		</main>
	</div>
	<WorkspaceCreationDialog
		bind:open={appState.isWorkspaceCreationDialogOpen}
		disabled={busy}
		{createWorkspace}
	/>
</Sidebar.Provider>
