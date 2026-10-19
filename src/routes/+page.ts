import { resolve } from "$app/paths";
import { unavailableWorkspaceUrl } from "$lib/app/workspace-home";
import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ parent }) => {
	const { sessionData } = await parent();
	if (sessionData.error) redirect(307, unavailableWorkspaceUrl(""));
	const session = sessionData.confirmed?.session;
	const id = session?.status === "ready" ? session.catalogue.active_workspace_id : null;
	redirect(307, id ? resolve("/workspaces/[id]", { id }) : resolve("/workspaces"));
};
