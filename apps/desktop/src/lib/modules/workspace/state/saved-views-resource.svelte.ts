import { createContext, tick } from "svelte";
import type { DesktopAPI, SavedView, SavedViewFilterValues } from "@tuxedo/contracts";
import type { WorkspaceCommands } from "./workspace-commands.svelte";
import type { SavedViewsData } from "./saved-views";

async function fingerprint(views: readonly SavedView[]) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(JSON.stringify(views))
	);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// A read-only route adapter plus command/refresh metadata; no saved-view snapshot lives here.
export class SavedViewsResource {
	private required = $state<{ workspaceId: string; signature: string }>();
	private refreshFailure = $state("");

	constructor(
		private readonly desktop: Pick<DesktopAPI, "saveView" | "deleteView">,
		private readonly session: WorkspaceCommands,
		private readonly getCurrent: () => SavedViewsData | undefined,
		private readonly refresh: (workspaceId: string) => Promise<void>
	) {}

	get views() {
		return this.current?.views ?? [];
	}
	private get current() {
		const data = this.getCurrent();
		return data?.workspaceId === this.session.activeWorkspace?.id ? data : undefined;
	}
	get error() {
		return (
			this.current?.error ||
			(this.required?.workspaceId === this.current?.workspaceId ? this.refreshFailure : "")
		);
	}
	get canWrite() {
		return !!this.current && !this.error && this.session.canMutate;
	}

	private async revalidate(workspaceId: string) {
		const previous = this.getCurrent();
		try {
			await this.refresh(workspaceId);
			await tick();
			const current = this.getCurrent();
			if (!current || current === previous || current.workspaceId !== workspaceId || current.error)
				throw Error(
					current?.error || "Saved views have not reached the screen. Retry the refresh."
				);
			if (
				this.required?.workspaceId === workspaceId &&
				(await fingerprint(current.views)) !== this.required.signature
			)
				throw Error("Saved views do not yet reflect the confirmed change. Retry the refresh.");
			this.required = undefined;
			this.refreshFailure = "";
			return { status: "applied" as const };
		} catch (error) {
			this.refreshFailure = error instanceof Error ? error.message : String(error);
			return { status: "rejected" as const, message: this.refreshFailure };
		}
	}

	retry = () => {
		const workspaceId = this.current?.workspaceId;
		return this.session.runAction(
			"refresh_saved_views",
			async () =>
				workspaceId
					? this.revalidate(workspaceId)
					: { status: "rejected", message: "Open a Workspace first." },
			workspaceId ? { workspaceId } : null
		);
	};

	private write(
		operation: "save_view" | "delete_view",
		command: (workspaceId: string) => ReturnType<DesktopAPI["saveView"]>
	) {
		const workspaceId = this.current?.workspaceId;
		return this.session.runAction(
			operation,
			async () => {
				// runAction owns admission by this point, so check data readiness without isOperating.
				if (!workspaceId || this.error || !this.session.ready)
					return { status: "rejected", message: "Refresh saved views before changing them." };
				const outcome = await command(workspaceId);
				if (outcome.status !== "applied") return outcome;
				this.required = {
					workspaceId,
					signature: await fingerprint(
						outcome.views.filter((view) => view.workspace_id === workspaceId)
					),
				};
				const refreshed = await this.revalidate(workspaceId);
				return refreshed.status === "applied"
					? refreshed
					: {
							status: "applied",
							notice: `View ${operation === "save_view" ? "saved" : "deleted"}, but saved views could not be refreshed. ${refreshed.message}`,
						};
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
