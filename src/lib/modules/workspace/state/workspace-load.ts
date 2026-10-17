import type { DesktopAPI } from "$lib/shared/desktop/contract";
import type { WorkspaceLoadedData } from "./electron-workspace-session.svelte";

export const sessionDependency = "desktop:session";
export const workspaceDependency = "desktop:workspace";
export const viewsDependency = "desktop:saved-views";

export async function readSessionData(desktop: DesktopAPI): Promise<WorkspaceLoadedData> {
	try {
		return { confirmed: await desktop.readSession({}) };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

export async function readViewsData(desktop: DesktopAPI): Promise<WorkspaceLoadedData> {
	try {
		const outcome = await desktop.readSavedViews({});
		return outcome.status === "applied"
			? { savedViews: outcome.views }
			: { savedViewsError: outcome.message };
	} catch (error) {
		return { savedViewsError: error instanceof Error ? error.message : String(error) };
	}
}
