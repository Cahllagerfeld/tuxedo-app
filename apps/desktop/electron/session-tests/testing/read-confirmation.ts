import type { ConfirmedSession, DesktopAPI } from "@tuxedo/contracts";

type ResourceReads = Pick<DesktopAPI, "readWorkspaceCatalogue" | "readWorkspace">;

// Assertions derive only confirmation already published by the public resource reads.
export async function readConfirmation(backend: ResourceReads): Promise<ConfirmedSession> {
	const read = await backend.readWorkspaceCatalogue({});
	if (read.status !== "ready" || !read.selection) throw Error("Expected a confirmed selection");
	const { scope, revision, undoLabel, workspaceId } = read.selection;
	if (!workspaceId) {
		const file = read.catalogue.active_workspace_id
			? await backend.readWorkspace({ workspaceId: read.catalogue.active_workspace_id })
			: undefined;
		return {
			scope,
			revision,
			...(undoLabel ? { undoLabel } : {}),
			session: {
				status: "empty",
				catalogue: read.catalogue,
				warning: file?.status === "rejected" ? file.message : null,
			},
		};
	}
	const file = await backend.readWorkspace({ workspaceId });
	if (file.status !== "ready" || file.provenance.status !== "confirmed")
		throw Error("Expected confirmed Workspace contents");
	return {
		scope,
		revision,
		...(undoLabel ? { undoLabel } : {}),
		session: {
			status: "ready",
			catalogue: read.catalogue,
			todo_file: file.todo_file,
		},
	};
}

export async function activateWorkspace(
	backend: Pick<DesktopAPI, "switchWorkspace">,
	workspaceId: string
) {
	const activated = await backend.switchWorkspace({ workspaceId });
	if (activated.status !== "applied") throw Error(activated.message);
	return activated.confirmed;
}
