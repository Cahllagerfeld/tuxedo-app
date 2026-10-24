import { page } from "$app/state";
import { readSavedViews, savedViewsDependency } from "#lib/modules/workspace/state/saved-views.js";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async ({ params, depends }) => {
	depends(savedViewsDependency(params.id));
	return {
		savedViews: await readSavedViews(window.desktop, params.id, () => page.data.savedViews),
	};
};
