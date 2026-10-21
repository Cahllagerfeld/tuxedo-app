import type { DesktopAPI, SavedView } from "@tuxedo/contracts";

export type SavedViewsData = {
	workspaceId: string;
	views: readonly SavedView[];
	error: string;
};

export const savedViewsDependency = (workspaceId: string): `tuxedodata:saved-views:${string}` =>
	`tuxedodata:saved-views:${workspaceId}`;

// Reads are repeatable, including speculative navigation. Only route data retains a failed refresh.
export async function readSavedViews(
	desktop: Pick<DesktopAPI, "readSavedViews">,
	workspaceId: string,
	getCurrent: () => SavedViewsData | undefined
): Promise<SavedViewsData> {
	try {
		const outcome = await desktop.readSavedViews({});
		if (outcome.status === "rejected") throw Error(outcome.message);
		return {
			workspaceId,
			views: outcome.views.filter((view) => view.workspace_id === workspaceId),
			error: "",
		};
	} catch (error) {
		const current = getCurrent();
		return {
			workspaceId,
			views: current?.workspaceId === workspaceId ? current.views : [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
