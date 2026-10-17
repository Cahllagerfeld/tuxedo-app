import { readViewsData, viewsDependency } from "$lib/modules/workspace/state/workspace-load";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async ({ depends }) => {
	depends(viewsDependency);
	return { viewsData: await readViewsData(window.desktop) };
};
