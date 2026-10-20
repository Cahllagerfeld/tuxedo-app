import { entryFailure } from "$lib/app/workspace-entry";
import { unavailableWorkspaceUrl } from "$lib/app/workspace-home";
import { redirect } from "@sveltejs/kit";
import { workspaceDestinationQuery } from "$lib/modules/workspace/state/workspace-queries";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, parent, depends }) => {
	// Discard a speculative route check after actual Workspace activation.
	depends(`workspace:destination:${params.id}`);
	const { queryClient } = await parent();
	const confirmed = await queryClient
		.query(workspaceDestinationQuery(window.desktop, params.id))
		.catch(() => undefined);
	const session = confirmed?.session;
	if (
		(entryFailure?.phase === "activate" && entryFailure.workspaceId === params.id) ||
		session?.status !== "ready" ||
		session.catalogue.active_workspace_id !== params.id
	)
		redirect(307, unavailableWorkspaceUrl(params.id));
	return { workspaceId: params.id };
};
