import type { DesktopAPI, DesktopResponse } from "$lib/shared/desktop/contract";

export const sessionDependency = "desktop:session";
export const workspaceDependency = (workspaceId: string): `desktop:workspace:${string}` =>
	`desktop:workspace:${workspaceId}`;
export const viewsDependency = "desktop:saved-views";

export async function readWorkspaceData(
	desktop: DesktopAPI,
	workspaceId: string
): Promise<DesktopResponse<"readWorkspace">> {
	try {
		return await desktop.readWorkspace({ workspaceId });
	} catch (error) {
		return { status: "rejected", message: error instanceof Error ? error.message : String(error) };
	}
}

export async function readSessionData(desktop: DesktopAPI) {
	try {
		return { confirmed: await desktop.readSession({}) };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

export async function readViewsData(desktop: DesktopAPI) {
	try {
		const outcome = await desktop.readSavedViews({});
		return outcome.status === "applied"
			? { savedViews: outcome.views }
			: { savedViewsError: outcome.message };
	} catch (error) {
		return { savedViewsError: error instanceof Error ? error.message : String(error) };
	}
}
