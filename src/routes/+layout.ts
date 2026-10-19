import {
	readSessionData,
	readViewsData,
	sessionDependency,
	viewsDependency,
} from "$lib/modules/workspace/state/workspace-load";
import type { LayoutLoad } from "./$types";
import { entryFailure } from "$lib/app/workspace-entry";

// The Electron renderer is a static SvelteKit SPA.
export const ssr = false;

export const load: LayoutLoad = async ({ depends, url }) => {
	// Actual navigation can activate a different session before its loads run.
	depends(sessionDependency, viewsDependency, `desktop:route:${url.pathname}`);
	const [sessionData, viewsData] = await Promise.all([
		entryFailure?.phase === "restore"
			? { confirmed: undefined, error: entryFailure.message }
			: readSessionData(window.desktop),
		readViewsData(window.desktop),
	]);
	return { sessionData, viewsData };
};
