import type { DesktopAPI, WorkspaceCatalogueRead, WorkspaceRead } from "@tuxedo/contracts";

export type CatalogueData = {
	value: Extract<WorkspaceCatalogueRead, { status: "ready" }> | null;
	error: string;
};
export type WorkspaceData = {
	workspaceId: string;
	value: Extract<WorkspaceRead, { status: "ready" }> | null;
	error: string;
};
export const catalogueDependency = "tuxedodata:catalogue";
export const workspaceDependency = (id: string): `tuxedodata:workspace:${string}` =>
	`tuxedodata:workspace:${id}`;

// On failure the current router resource retains its own value, never a parallel cache.
export async function readCatalogue(
	desktop: Pick<DesktopAPI, "readWorkspaceCatalogue">,
	current: () => CatalogueData | undefined
): Promise<CatalogueData> {
	try {
		const value = await desktop.readWorkspaceCatalogue({});
		if (value.status === "rejected") throw Error(value.message);
		return { value, error: "" };
	} catch (error) {
		return {
			value: current()?.value ?? null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
export async function readWorkspace(
	desktop: Pick<DesktopAPI, "readWorkspace">,
	workspaceId: string,
	current: () => WorkspaceData | undefined
): Promise<WorkspaceData> {
	try {
		const value = await desktop.readWorkspace({ workspaceId });
		if (value.status === "rejected") throw Error(value.message);
		if (value.workspace.id !== workspaceId)
			throw Error("Workspace read returned a different destination.");
		const previous = current();
		if (
			previous?.workspaceId === workspaceId &&
			previous.value?.provenance.status === "confirmed" &&
			previous.value.todo_file.path === value.todo_file.path &&
			(value.provenance.status === "speculative" ||
				(previous.value.provenance.selection.scope === value.provenance.selection.scope &&
					previous.value.provenance.selection.revision > value.provenance.selection.revision))
		) {
			return {
				workspaceId,
				value: previous.value,
				error: "Todo-file contents are waiting for a confirmed refresh.",
			};
		}
		return { workspaceId, value, error: "" };
	} catch (error) {
		const previous = current();
		return {
			workspaceId,
			value: previous?.workspaceId === workspaceId ? previous.value : null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
