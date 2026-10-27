import { createContext } from "svelte";
import type { AppState } from "./app-state.svelte";
import type { WorkspaceUiState } from "#lib/modules/workspace/ui/workspace-ui-state.svelte.js";

export const [getAppState, setAppState] = createContext<AppState>();
export const [getWorkspaceUi, setWorkspaceUi] = createContext<WorkspaceUiState>();
