import { resolve } from "$app/paths";
import { unavailableWorkspaceUrl } from "$lib/app/workspace-home";
import { redirect } from "@sveltejs/kit";
import { workspaceSessionQuery } from "$lib/modules/workspace/state/workspace-queries";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ parent }) => {
	const { queryClient } = await parent();
	const confirmed = queryClient.getQueryData(workspaceSessionQuery(window.desktop).queryKey);
	if (!confirmed) redirect(307, unavailableWorkspaceUrl(""));
	const session = confirmed.session;
	const id = session?.status === "ready" ? session.catalogue.active_workspace_id : null;
	redirect(307, id ? resolve("/workspaces/[id]", { id }) : resolve("/workspaces"));
};
