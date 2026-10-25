import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async ({ params }) => {
	const workspaceId = params.id;
	try {
		return {
			savedViews: { workspaceId, outcome: await window.desktop.readSavedViews({ workspaceId }) },
		};
	} catch (error) {
		return {
			savedViews: {
				workspaceId,
				outcome: {
					status: "rejected" as const,
					message: error instanceof Error ? error.message : String(error),
				},
			},
		};
	}
};
