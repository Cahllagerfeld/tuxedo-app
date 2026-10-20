<script lang="ts">
	import { page } from "$app/state";
	import { createWorkspaceApp } from "$lib/app/workspace-app.svelte";
	import { setShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import WorkspaceCreationDialog from "$lib/modules/workspace/ui/WorkspaceCreationDialog.svelte";
	import * as Sidebar from "$lib/shared/ui/sidebar/index";
	import { Toaster } from "$lib/shared/ui/sonner";
	import { ModeWatcher } from "mode-watcher";
	import { untrack } from "svelte";
	import { Skeleton } from "$lib/shared/ui/skeleton";
	import * as Alert from "$lib/shared/ui/alert";
	import { Button } from "$lib/shared/ui/button";
	import { workspaceSessionQuery } from "$lib/modules/workspace/state/workspace-queries";
	import { QueryClientProvider, createQuery } from "@tanstack/svelte-query";
	import type { LayoutProps } from "./$types";
	import "./layout.css";
	let { data, children }: LayoutProps = $props();

	setShortcutScope();
	const queryClient = untrack(() => data.queryClient);
	const sessionQuery = createQuery(
		() => workspaceSessionQuery(window.desktop),
		() => queryClient
	);
	let creationDialogOpen = $state(false);
	const navigation = createWorkspaceApp(queryClient, sessionQuery, () => {
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
		{#if sessionQuery.isPending}
			<div class="flex flex-1 gap-4 p-4" role="status" aria-label="Loading Workspaces">
				<Skeleton class="w-64 rounded-xl" />
				<div class="flex flex-1 flex-col gap-4">
					<Skeleton class="h-10 w-1/3" /><Skeleton class="h-48 w-full" />
				</div>
			</div>
		{:else if sessionQuery.isError && !sessionQuery.data}
			<Alert.Root variant="destructive" class="m-4 w-auto">
				<Alert.Title>Workspaces unavailable</Alert.Title>
				<Alert.Description>{sessionQuery.error.message}</Alert.Description>
				<Button disabled={navigation.busy} onclick={() => navigation.retry()}>Retry</Button>
			</Alert.Root>
		{:else}
			{#if sessionQuery.isError && page.route.id !== "/workspaces"}
				<Alert.Root variant="destructive" class="m-4 w-auto">
					<Alert.Title>Could not refresh Workspaces</Alert.Title>
					<Alert.Description>{sessionQuery.error.message}</Alert.Description>
					<Button disabled={navigation.busy} onclick={() => navigation.retry()}>Retry</Button>
				</Alert.Root>
			{/if}
			{@render children()}
		{/if}
		<WorkspaceCreationDialog
			bind:open={creationDialogOpen}
			disabled={navigation.busy}
			createWorkspace={navigation.createWorkspace}
		/>
	</Sidebar.Provider>
</QueryClientProvider>
