import { page } from "$app/state";
import {
	catalogueDependency,
	readCatalogue,
} from "#lib/modules/workspace/state/workspace-route-data.js";
import type { LayoutLoad } from "./$types";

// The Electron renderer is a static SvelteKit SPA.
export const ssr = false;
export const load: LayoutLoad = async ({ depends }) => {
	depends(catalogueDependency);
	return { catalogue: await readCatalogue(window.desktop, () => page.data.catalogue) };
};
