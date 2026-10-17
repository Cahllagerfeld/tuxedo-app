import { createContext } from "svelte";
import type { AppState } from "./app-state.svelte";
import type { createWorkspaceNavigation } from "./workspace-navigation.svelte";

export const [getAppContext, setAppContext] = createContext<{
	app: AppState;
	navigation: ReturnType<typeof createWorkspaceNavigation>;
}>();
