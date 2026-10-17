import { readSessionData, sessionDependency } from "$lib/modules/workspace/state/workspace-load";
import type { LayoutLoad } from "./$types";

// The Electron renderer is a static SvelteKit SPA.
export const ssr = false;

export const load: LayoutLoad = async ({ depends }) => {
	depends(sessionDependency);
	return { sessionData: await readSessionData(window.desktop) };
};
