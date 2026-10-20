import { WorkspaceCommands } from "./workspace-commands.svelte";
import { WorkspaceData } from "./workspace-data.svelte";
import { createWorkspaceQueryClient, workspaceViewsQuery } from "./workspace-queries";
import type { ConfirmedSession, ConfirmedTodo, DesktopAPI } from "$lib/shared/desktop/contract";

// Model backend confirmations for isolated renderer tests.
export class WorkspaceSessionFixture extends WorkspaceCommands {
	initialize: WorkspaceCommands["restore"];
	private readonly clearQueries: () => void;
	constructor(desktop: DesktopAPI, onRefreshed: () => void = () => {}) {
		let backend: ConfirmedSession | undefined;
		const adapter = new Proxy(desktop, {
			get(target, key: keyof DesktopAPI) {
				return async (...args: unknown[]) => {
					if (key === "readSession") {
						if (!backend) throw Error("No Workspace data loaded.");
						return backend;
					}
					const outcome = await Reflect.apply(target[key], target, args);
					if (key === "restoreSession") backend = outcome;
					else if (outcome?.confirmed && outcome.status !== "rejected") {
						const incoming: ConfirmedSession | ConfirmedTodo = outcome.confirmed;
						if ("session" in incoming) backend = incoming;
						else if (backend?.session.status === "ready")
							backend = {
								...backend,
								revision: incoming.revision,
								undoLabel: incoming.undoLabel,
								session: { ...backend.session, todo_file: incoming.todo_file },
							};
					}
					return outcome;
				};
			},
		});
		const queryClient = createWorkspaceQueryClient();
		const viewsLoaded = queryClient.query(workspaceViewsQuery(adapter)).catch(() => undefined);
		const data = new WorkspaceData(adapter, queryClient);
		super(
			adapter,
			data,
			queryClient,
			() => false,
			async () => onRefreshed()
		);
		this.clearQueries = () => queryClient.clear();
		this.initialize = async () => {
			const outcome = await this.restore();
			await viewsLoaded;
			return outcome;
		};
	}
	override destroy() {
		super.destroy();
		this.data.destroy();
		this.clearQueries();
	}
	get session() {
		return this.data.session;
	}
	get catalogue() {
		return this.data.catalogue;
	}
	get activeWorkspace() {
		return this.data.activeWorkspace;
	}
	get todoFile() {
		return this.data.todoFile;
	}
	get undoLabel() {
		return this.data.undoLabel;
	}
	get error() {
		return this.data.error;
	}
	get warning() {
		return this.data.warning;
	}
	get savedViews() {
		return this.data.savedViews;
	}
	get savedViewsError() {
		return this.data.savedViewsError;
	}
}
