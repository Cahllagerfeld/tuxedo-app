import { page } from "$app/state";
import {
	readWorkspace,
	workspaceDependency,
} from "#lib/modules/workspace/state/workspace-route-data.js";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, depends }) => {
	depends(workspaceDependency(params.id));
	return { workspace: await readWorkspace(window.desktop, params.id, () => page.data.workspace) };
};
