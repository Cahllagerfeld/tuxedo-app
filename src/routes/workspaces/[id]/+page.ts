import { workspaceDependency } from "$lib/modules/workspace/state/workspace-load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, depends }) => {
	depends(workspaceDependency);
	try {
		return { destination: await window.desktop.readWorkspace({ workspaceId: params.id }) };
	} catch (error) {
		return {
			destination: {
				status: "rejected" as const,
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
};
