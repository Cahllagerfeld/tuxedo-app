import {
	createWorkspaceQueryClient,
	workspaceSessionQuery,
	workspaceViewsQuery,
} from "$lib/modules/workspace/state/workspace-queries";
import type { LayoutLoad } from "./$types";
import { entryFailure } from "$lib/app/workspace-entry";

export const ssr = false;

// One cache per renderer, including when a load is explicitly rerun.
const queryClient = createWorkspaceQueryClient();

export const load: LayoutLoad = async () => {
	await Promise.all([
		queryClient
			.query({
				...workspaceSessionQuery(window.desktop),
				...(entryFailure?.phase === "restore"
					? {
							queryFn: async () => {
								throw Error(entryFailure?.message);
							},
						}
					: {}),
			})
			.catch(() => undefined),
		queryClient.query(workspaceViewsQuery(window.desktop)).catch(() => undefined),
	]);
	return { queryClient };
};
