import { createContext } from "svelte";
import type { CreateQueryResult } from "@tanstack/svelte-query";
import type { DesktopResponse } from "$lib/shared/desktop/contract";
import type { createWorkspaceNavigation } from "./workspace-navigation.svelte";
import type { WorkspaceCommands } from "$lib/modules/workspace/state/workspace-commands.svelte";

export const [getWorkspaceContext, setWorkspaceContext] = createContext<{
	sessionQuery: CreateQueryResult<DesktopResponse<"readSession">>;
	commands: WorkspaceCommands;
	navigation: ReturnType<typeof createWorkspaceNavigation>;
	openWorkspaceCreationDialog: () => void;
}>();
