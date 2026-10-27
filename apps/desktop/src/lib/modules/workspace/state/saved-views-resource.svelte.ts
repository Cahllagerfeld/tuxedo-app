import { createContext } from "svelte";
import type { DesktopAPI } from "@tuxedo/contracts";
import type { WorkspaceCommands } from "./workspace-commands.svelte";
import type { SavedViewsData } from "./workspace-route-data";
import type { InvalidateDisplayedData } from "./invalidate-displayed-data";
import { savedViewCommands } from "./saved-view-commands";

export type SavedViewsRoutes = {
	current: () => SavedViewsData | undefined;
	workspaceId: () => string | undefined;
	invalidate: InvalidateDisplayedData;
};

export class SavedViewsResource {
	private failure = $state<{ workspaceId: string; message: string }>();
	readonly retry;
	readonly save;
	readonly delete;
	constructor(
		desktop: Pick<DesktopAPI, "saveView" | "deleteView">,
		private readonly session: WorkspaceCommands,
		private readonly routes: SavedViewsRoutes
	) {
		const commands = savedViewCommands({
			desktop,
			gate: session.gate,
			invalidate: routes.invalidate,
			workspaceId: routes.workspaceId,
			writable: () => this.writable,
			readError: () => this.current?.error ?? "",
			setFailure: (workspaceId, message) => {
				if (message) this.failure = { workspaceId, message };
				else if (this.failure?.workspaceId === workspaceId) this.failure = undefined;
			},
		});
		this.retry = commands.retry;
		this.save = commands.save;
		this.delete = commands.delete;
	}
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
	private get writable() {
		return !!this.current && !this.error && this.session.ready;
	}
	get canWrite() {
		return this.writable && !this.session.isOperating;
	}
}
export const [getSavedViews, setSavedViews] = createContext<SavedViewsResource>();
