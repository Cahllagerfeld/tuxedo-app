import { createContext } from "svelte";
import type { DesktopAPI, SavedViewFilterValues } from "@tuxedo/contracts";
import type { WorkspaceCommands } from "./workspace-commands.svelte";
import type { WorkspaceSessionActionResult } from "./workspace-session-types";
import type { SavedViewsData } from "./workspace-route-data";

export type SavedViewsRoutes = {
	current: () => SavedViewsData | undefined;
	workspaceId: () => string | undefined;
	refresh: (workspaceId: string) => Promise<void>;
};

export class SavedViewsResource {
	private failure = $state<{ workspaceId: string; message: string }>();
	constructor(
		private readonly desktop: Pick<DesktopAPI, "saveView" | "deleteView">,
		private readonly session: WorkspaceCommands,
		private readonly routes: SavedViewsRoutes
	) {}
	private get current() {
		const data = this.routes.current();
		return data?.workspaceId === this.routes.workspaceId() ? data : undefined;
	}
	get views() {
		return this.current?.views ?? [];
	}
	get error() {
		return (
			(this.failure?.workspaceId === this.routes.workspaceId() ? this.failure?.message : "") ||
			this.current?.error ||
			""
		);
	}
	get canWrite() {
		return !!this.current && !this.error && this.session.canMutate;
	}
	private async refresh(workspaceId: string): Promise<WorkspaceSessionActionResult> {
		try {
			await this.routes.refresh(workspaceId);
			if (this.current?.error) throw Error(this.current.error);
			this.failure = undefined;
			return { status: "applied" };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.failure = { workspaceId, message };
			return { status: "rejected", message };
		}
	}
	retry = () =>
		this.session.runAction("refresh_saved_views", async () => {
			const workspaceId = this.routes.workspaceId();
			return workspaceId
				? this.refresh(workspaceId)
				: { status: "rejected", message: "Open a Workspace first." };
		});
	private write(
		operation: "save_view" | "delete_view",
		command: (workspaceId: string) => ReturnType<DesktopAPI["saveView"]>
	) {
		const workspaceId = this.routes.workspaceId();
		return this.session.runAction(
			operation,
			async () => {
				if (!workspaceId || !this.current || this.error || !this.session.ready)
					return { status: "rejected", message: "Refresh saved views before changing them." };
				try {
					const outcome = await command(workspaceId);
					if (outcome.status !== "applied") return outcome;
					if (outcome.workspaceId !== workspaceId)
						throw Error("Saved views belong to a different Workspace.");
					const refreshed = await this.refresh(workspaceId);
					return {
						status: "applied",
						...(refreshed.status === "rejected"
							? {
									notice:
										"Change saved, but saved views could not be refreshed. " + refreshed.message,
								}
							: {}),
					};
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					this.failure = { workspaceId, message };
					return { status: "rejected", message };
				}
			},
			workspaceId ? { workspaceId } : null
		);
	}
	save = (name: string, filters: SavedViewFilterValues) =>
		this.write("save_view", (workspaceId) => this.desktop.saveView({ workspaceId, name, filters }));
	delete = (viewId: string) =>
		this.write("delete_view", (workspaceId) => this.desktop.deleteView({ workspaceId, viewId }));
}
export const [getSavedViews, setSavedViews] = createContext<SavedViewsResource>();
