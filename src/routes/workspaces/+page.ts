import { entryFailure } from "$lib/app/workspace-entry";
import { unavailableWorkspaceUrl } from "$lib/app/workspace-home";
import { resolve } from "$app/paths";
import { redirect } from "@sveltejs/kit";
import { workspaceSessionQuery } from "$lib/modules/workspace/state/workspace-queries";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ url, parent }) => {
	const { queryClient } = await parent();
	const query = workspaceSessionQuery(window.desktop);
	const confirmed = queryClient.getQueryData(query.queryKey);
	const session = confirmed?.session;
	const id = url.searchParams.get("unavailable") ?? undefined;
	if (!url.searchParams.has("unavailable")) {
		if (!confirmed || session?.status === "unavailable") redirect(307, unavailableWorkspaceUrl(""));
		if (session?.status === "empty" && session.warning)
			redirect(307, unavailableWorkspaceUrl(session.catalogue.active_workspace_id ?? ""));
		if (session?.status === "ready" && session.catalogue.active_workspace_id)
			redirect(307, resolve("/workspaces/[id]", { id: session.catalogue.active_workspace_id }));
	}
	return {
		unavailableMessage:
			(entryFailure?.phase === "activate" && entryFailure.workspaceId === id
				? entryFailure.message
				: undefined) ||
			queryClient.getQueryState(query.queryKey)?.error?.message ||
			(session?.status === "unavailable" ? session.error : undefined) ||
			(session?.status === "empty" ? session.warning : undefined) ||
			undefined,
	};
};
