import { entryFailure } from "$lib/app/workspace-entry";
import {
	readWorkspaceData,
	sessionDependency,
	workspaceDependency,
} from "$lib/modules/workspace/state/workspace-load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ depends, params }) => {
	depends(sessionDependency, workspaceDependency(params.id));
	const destination = await readWorkspaceData(window.desktop, params.id);
	const destinationError =
		entryFailure?.phase === "activate" && entryFailure.workspaceId === params.id
			? entryFailure.message
			: undefined;
	return { destination, destinationError };
};
