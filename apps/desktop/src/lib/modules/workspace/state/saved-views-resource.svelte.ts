import { createContext } from "svelte";
import type {
	DesktopAPI,
	DesktopResponse,
	SavedView,
	SavedViewFilterValues,
} from "@tuxedo/contracts";
import type { WorkspaceCommands } from "./workspace-commands.svelte";
import type { WorkspaceSessionActionResult } from "./workspace-session-types";

export class SavedViewsResource {
	private data = $state.raw<{ workspaceId: string; views: readonly SavedView[] }>();
	private failure = $state<{ workspaceId: string; message: string }>();
	private loading = $state<string>();
	private generation = 0;
	private workspaceId: string | undefined;
	private loaded: DesktopResponse<"readSavedViews"> | undefined;

	constructor(
		private readonly desktop: Pick<DesktopAPI, "readSavedViews" | "saveView" | "deleteView">,
		private readonly session: WorkspaceCommands
	) {}

	get views() {
		return this.data && this.data.workspaceId === this.session.activeWorkspace?.id
			? this.data.views
			: [];
	}
	get error() {
		return this.failure && this.failure.workspaceId === this.session.activeWorkspace?.id
			? this.failure.message
			: "";
	}
	get canWrite() {
		return (
			this.data?.workspaceId === this.session.activeWorkspace?.id &&
			!this.loading &&
			!this.error &&
			this.session.canMutate
		);
	}
	acceptLoaded(workspaceId: string, outcome: DesktopResponse<"readSavedViews">) {
		// Same-Workspace navigation may reuse a preload from before a direct command response.
		if (this.workspaceId === workspaceId && this.loaded === outcome) return;
		this.workspaceId = workspaceId;
		this.loaded = outcome;
		++this.generation;
		this.loading = undefined;
		if (outcome.status === "rejected") this.failure = { workspaceId, message: outcome.message };
		else if (outcome.workspaceId !== workspaceId)
			this.failure = { workspaceId, message: "Saved views belong to a different Workspace." };
		else {
			this.data = outcome;
			this.failure = undefined;
		}
	}
	load = async (workspaceId: string): Promise<WorkspaceSessionActionResult> => {
		const generation = ++this.generation;
		this.workspaceId = workspaceId;
		this.loading = workspaceId;
		try {
			const outcome = await this.desktop.readSavedViews({ workspaceId });
			if (outcome.status !== "applied") throw Error(outcome.message);
			if (outcome.workspaceId !== workspaceId)
				throw Error("Saved views belong to a different Workspace.");
			if (generation === this.generation) {
				this.data = outcome;
				this.failure = undefined;
			}
			return { status: "applied" };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (generation === this.generation) this.failure = { workspaceId, message };
			return { status: "rejected", message };
		} finally {
			if (generation === this.generation) this.loading = undefined;
		}
	};
	retry = () =>
		this.session.runAction("refresh_saved_views", async () => {
			const workspaceId = this.session.activeWorkspace?.id;
			return workspaceId
				? this.load(workspaceId)
				: { status: "rejected", message: "Open a Workspace first." };
		});

	private write(
		operation: "save_view" | "delete_view",
		command: (workspaceId: string) => ReturnType<DesktopAPI["saveView"]>
	) {
		const workspaceId = this.session.activeWorkspace?.id;
		return this.session.runAction(
			operation,
			async () => {
				if (
					!workspaceId ||
					this.data?.workspaceId !== workspaceId ||
					this.loading ||
					this.error ||
					!this.session.ready
				)
					return { status: "rejected", message: "Refresh saved views before changing them." };
				try {
					const outcome = await command(workspaceId);
					if (outcome.status !== "applied") return outcome;
					if (outcome.workspaceId !== workspaceId)
						throw Error("Saved views belong to a different Workspace.");
					++this.generation;
					this.data = outcome;
					this.failure = undefined;
					this.loading = undefined;
					return { status: "applied" };
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
