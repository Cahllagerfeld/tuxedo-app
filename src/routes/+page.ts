import { resolve } from "$app/paths";
import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ parent }) => {
	const { sessionData } = await parent();
	const session = sessionData.confirmed?.session;
	const id =
		session?.status === "ready" || session?.status === "empty"
			? session.catalogue.active_workspace_id
			: null;
	redirect(307, id ? resolve("/workspaces/[id]", { id }) : resolve("/workspaces"));
};
