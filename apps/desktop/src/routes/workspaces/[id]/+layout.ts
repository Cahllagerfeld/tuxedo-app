import type { LayoutLoad } from "./$types";
import { page } from "$app/state";
import {
	readSavedViews,
	savedViewsDependency,
} from "#lib/modules/workspace/state/workspace-route-data.js";

export const load: LayoutLoad = async ({ params, depends }) => {
	const workspaceId = params.id;
	depends(savedViewsDependency(workspaceId));
	return {
		savedViews: await readSavedViews(window.desktop, workspaceId, () => page.data.savedViews),
	};
};
