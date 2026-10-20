import { navigating, page } from "$app/state";
import { onDestroy } from "svelte";
import type { QueryClient, CreateQueryResult } from "@tanstack/svelte-query";
import type { DesktopResponse } from "$lib/shared/desktop/contract";
import { WorkspaceCommands } from "$lib/modules/workspace/state/workspace-commands.svelte";
import { setWorkspaceContext } from "./app-context";
import { createWorkspaceNavigation } from "./workspace-navigation.svelte";

export function createWorkspaceApp(
	queryClient: QueryClient,
	sessionQuery: CreateQueryResult<DesktopResponse<"readSession">>,
	openWorkspaceCreationDialog: () => void
) {
	const commands = new WorkspaceCommands(
		window.desktop,
		queryClient,
		() => page.params.id,
		() => !!navigating.to,
		async (dependency) => {
			if (dependency !== "views") await navigation.recover();
		}
	);
	const navigation = createWorkspaceNavigation(commands, sessionQuery);
	onDestroy(() => commands.destroy());
	setWorkspaceContext({ sessionQuery, commands, navigation, openWorkspaceCreationDialog });
	return navigation;
}
