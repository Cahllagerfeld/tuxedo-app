import { entryFailure } from "$lib/app/workspace-entry";
import { unavailableWorkspaceUrl } from "$lib/app/workspace-home";
import { redirect } from "@sveltejs/kit";
import {
	readWorkspaceData,
	sessionDependency,
	workspaceDependency,
} from "$lib/modules/workspace/state/workspace-load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ depends, params, parent }) => {
	depends(sessionDependency, workspaceDependency(params.id));
	const [{ sessionData }, destination] = await Promise.all([
		parent(),
		readWorkspaceData(window.desktop, params.id),
	]);
	const session = sessionData.confirmed?.session;
	if (
		(entryFailure?.phase === "activate" && entryFailure.workspaceId === params.id) ||
		destination.status !== "loaded" ||
		session?.status !== "ready" ||
		session.catalogue.active_workspace_id !== params.id ||
		JSON.stringify(destination.todo_file) !== JSON.stringify(session.todo_file)
	)
		redirect(307, unavailableWorkspaceUrl(params.id));
	return { destination };
};
