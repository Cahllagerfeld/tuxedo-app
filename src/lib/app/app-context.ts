import { createContext } from "svelte";
import type { createReaderState } from "./reader-state.svelte";
import type { createWorkspaceNavigation } from "./workspace-navigation.svelte";
import type { WorkspaceCommands } from "$lib/modules/workspace/state/workspace-commands.svelte";

export const [getWorkspaceContext, setWorkspaceContext] = createContext<{
	workspace: WorkspaceCommands;
	reader: ReturnType<typeof createReaderState>;
	navigation: ReturnType<typeof createWorkspaceNavigation>;
	openWorkspaceCreationDialog: () => void;
}>();
