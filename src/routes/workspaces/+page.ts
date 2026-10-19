import { entryFailure } from "$lib/app/workspace-entry";
import { unavailableWorkspaceUrl } from "$lib/app/workspace-home";
import { resolve } from "$app/paths";
import { redirect } from "@sveltejs/kit";
import {
	readWorkspaceData,
	workspaceDependency,
} from "$lib/modules/workspace/state/workspace-load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ url, depends, parent }) => {
	const id = url.searchParams.get("unavailable");
	if (!id) {
		const { sessionData } = await parent();
		const session = sessionData.confirmed?.session;
		if (!url.searchParams.has("unavailable")) {
			if (sessionData.error) redirect(307, unavailableWorkspaceUrl(""));
			if (session?.status === "empty" && session.warning)
				redirect(307, unavailableWorkspaceUrl(session.catalogue.active_workspace_id ?? ""));
			if (session?.status === "ready" && session.catalogue.active_workspace_id)
				redirect(307, resolve("/workspaces/[id]", { id: session.catalogue.active_workspace_id }));
		}
		return { unavailableMessage: undefined };
	}
	depends(workspaceDependency(id));
	const [{ sessionData }, destination] = await Promise.all([
		parent(),
		readWorkspaceData(window.desktop, id),
	]);
	const session = sessionData.confirmed?.session;
	return {
		unavailableMessage:
			(entryFailure?.phase === "activate" && entryFailure.workspaceId === id
				? entryFailure.message
				: undefined) ||
			(destination.status === "rejected" ? destination.message : undefined) ||
			sessionData.error ||
			(session?.status === "empty" ? session.warning : undefined) ||
			"Could not load this Workspace. Retry loading, or choose another Workspace.",
	};
};
