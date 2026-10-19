// Only startup's command failure crosses into the first load; confirmed data belongs to loads.
export let entryFailure:
	| { phase: "restore"; message: string }
	| { phase: "activate"; workspaceId: string; message: string }
	| undefined;
export function clearEntryFailure() {
	entryFailure = undefined;
}

export async function prepareWorkspaceEntry() {
	let activatingId: string | undefined;
	try {
		const restored = await window.desktop.restoreSession({});
		const id = location.pathname.match(/^\/workspaces\/([^/]+)\/?$/)?.[1];
		const active =
			restored.session.status === "ready" ? restored.session.catalogue.active_workspace_id : null;
		if (id && id !== active) {
			activatingId = decodeURIComponent(id);
			const outcome = await window.desktop.switchWorkspace({ workspaceId: activatingId });
			if (outcome.status === "rejected")
				entryFailure = { phase: "activate", workspaceId: activatingId, message: outcome.message };
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		entryFailure = activatingId
			? { phase: "activate", workspaceId: activatingId, message }
			: { phase: "restore", message };
	}
}
