import type { LayoutLoad } from "./$types";
import { page } from "$app/state";
import {
	readSession,
	sessionDependency,
} from "#lib/modules/workspace/state/workspace-route-data.js";

// The Electron renderer is a static SvelteKit SPA.
export const ssr = false;

export const load: LayoutLoad = async ({ depends }) => {
	depends(sessionDependency);
	return {
		session: await readSession(window.desktop, () => page.data.session),
	};
};
