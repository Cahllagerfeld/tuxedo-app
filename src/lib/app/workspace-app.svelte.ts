import { afterNavigate } from "$app/navigation";
import { navigating, page } from "$app/state";
import { onDestroy } from "svelte";
import type { QueryClient } from "@tanstack/svelte-query";
import { WorkspaceCommands } from "$lib/modules/workspace/state/workspace-commands.svelte";
import { WorkspaceData } from "$lib/modules/workspace/state/workspace-data.svelte";
import { workspaceSessionQuery } from "$lib/modules/workspace/state/workspace-queries";
import { setWorkspaceContext } from "./app-context";
import { createReaderState } from "./reader-state.svelte";
import { createWorkspaceNavigation } from "./workspace-navigation.svelte";

export function createWorkspaceApp(
	queryClient: QueryClient,
	openWorkspaceCreationDialog: () => void
) {
	const workspace = new WorkspaceData(window.desktop, queryClient, () => page.params.id);
	// Connect route identity to the external Query subscription.
	$effect(() => workspace.observeDestination(page.params.id));
	const commands = new WorkspaceCommands(
		window.desktop,
		workspace,
		queryClient,
		() => !!navigating.to,
		async (dependency) => {
			reader.todoFilter.reconcileSource();
			if (dependency === "session") await navigation.recover();
			if (commands.pendingOperation === "delete_workspace") {
				const confirmed = queryClient.getQueryData(workspaceSessionQuery(window.desktop).queryKey);
				if (confirmed?.session.status !== "ready") await navigation.recover(true);
			}
		}
	);
	const reader = createReaderState(workspace, commands);
	const navigation = createWorkspaceNavigation(commands);
	onDestroy(() => {
		commands.destroy();
		workspace.destroy();
	});
	afterNavigate((event) => {
		if (event.from?.params?.id !== event.to?.params?.id)
			void event.complete.then(() => {
				reader.creationOpen = false;
				reader.bulkSelection.exit();
			});
	});
	setWorkspaceContext({ workspace, commands, reader, navigation, openWorkspaceCreationDialog });
	return navigation;
}
