import type { ConfirmedSession, DesktopAPI, SavedView, WorkspaceRead } from "@tuxedo/contracts";

export const sessionDependency = "tuxedodata:session";
export const workspaceDependency = (id: string) => `tuxedodata:workspace/${id}` as const;
export const savedViewsDependency = (id: string) => `tuxedodata:saved-views/${id}` as const;

export type SessionData = { value: ConfirmedSession | null; error: string };
export type WorkspaceData = {
	workspaceId: string;
	value: Extract<WorkspaceRead, { status: "ready" }> | null;
	error: string;
};
export type SavedViewsData = {
	workspaceId: string;
	views: readonly SavedView[];
	error: string;
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function readSession(
	desktop: Pick<DesktopAPI, "readSession">,
	previous: () => SessionData | undefined
): Promise<SessionData> {
	try {
		const value = await desktop.readSession({});
		if (value.session.status === "unavailable") throw Error(value.session.error);
		return { value, error: "" };
	} catch (error) {
		return { value: previous()?.value ?? null, error: message(error) };
	}
}

export async function readWorkspace(
	desktop: Pick<DesktopAPI, "readWorkspace">,
	workspaceId: string,
	previous: () => WorkspaceData | undefined
): Promise<WorkspaceData> {
	try {
		const value = await desktop.readWorkspace({ workspaceId });
		if (value.status === "rejected") throw Error(value.message);
		return { workspaceId, value, error: "" };
	} catch (error) {
		const current = previous();
		return {
			workspaceId,
			value: current?.workspaceId === workspaceId ? current.value : null,
			error: message(error),
		};
	}
}

export async function readSavedViews(
	desktop: Pick<DesktopAPI, "readSavedViews">,
	workspaceId: string,
	previous: () => SavedViewsData | undefined
): Promise<SavedViewsData> {
	try {
		const outcome = await desktop.readSavedViews({ workspaceId });
		if (outcome.status === "rejected") throw Error(outcome.message);
		if (outcome.workspaceId !== workspaceId)
			throw Error("Saved views belong to a different Workspace.");
		return { workspaceId, views: outcome.views, error: "" };
	} catch (error) {
		const current = previous();
		return {
			workspaceId,
			views: current?.workspaceId === workspaceId ? current.views : [],
			error: message(error),
		};
	}
}
