import {
	readSessionData,
	readViewsData,
	readWorkspaceData,
	sessionDependency,
	viewsDependency,
	workspaceDependency,
} from "$lib/modules/workspace/state/workspace-load";
import type { LayoutLoad } from "./$types";
import { entryFailure } from "$lib/app/workspace-entry";

// The Electron renderer is a static SvelteKit SPA.
export const ssr = false;

export const load: LayoutLoad = async ({ depends, params }) => {
	depends(sessionDependency);
	depends(viewsDependency);
	if (params.id) depends(workspaceDependency(params.id));
	const [sessionData, viewsData, destination] = await Promise.all([
		entryFailure?.phase === "restore"
			? { error: entryFailure.message }
			: readSessionData(window.desktop),
		readViewsData(window.desktop),
		params.id ? readWorkspaceData(window.desktop, params.id) : undefined,
	]);
	const destinationError =
		entryFailure?.phase === "activate" && entryFailure.workspaceId === params.id
			? entryFailure.message
			: undefined;
	return { sessionData, viewsData, destination, destinationError };
};
