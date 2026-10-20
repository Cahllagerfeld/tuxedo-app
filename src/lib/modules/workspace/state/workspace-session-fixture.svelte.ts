import { WorkspaceCommands } from "./workspace-commands.svelte";
import {
	createWorkspaceQueryClient,
	workspaceViewsQuery,
	workspaceSessionQuery,
	workspaceQueryKeys,
	type WorkspaceDestination,
} from "./workspace-queries";
import type { QueryClient } from "@tanstack/svelte-query";
import type {
	ConfirmedSession,
	ConfirmedTodo,
	DesktopAPI,
	SavedView,
} from "$lib/shared/desktop/contract";

export function createFixtureQueryClient(desktop: DesktopAPI) {
	const client = createWorkspaceQueryClient();
	client.setQueryDefaults(workspaceQueryKeys.session, {
		queryFn: () => desktop.readSession({}),
	});
	client.setQueryDefaults(workspaceQueryKeys.views, {
		queryFn: async () => {
			const response = await desktop.readSavedViews({});
			if (response.status !== "applied") throw Error(response.message);
			return response.views;
		},
	});
	return client;
}

export function workspaceFixtureData(
	queryClient: QueryClient,
	getWorkspaceId: () => string | undefined = () => undefined
) {
	const confirmed = () => queryClient.getQueryData<ConfirmedSession>(workspaceQueryKeys.session);
	const session = () =>
		confirmed()?.session ?? {
			status: "unavailable" as const,
			error: queryClient.getQueryState(workspaceQueryKeys.session)?.error?.message ?? "",
		};
	const catalogue = () => {
		const current = session();
		return current.status === "ready" || current.status === "empty" ? current.catalogue : null;
	};
	return {
		get confirmed() {
			return confirmed();
		},
		get session() {
			return session();
		},
		get catalogue() {
			return catalogue();
		},
		get activeWorkspace() {
			const current = catalogue();
			return (
				current?.workspaces.find(
					(workspace) => workspace.id === (getWorkspaceId() ?? current.active_workspace_id)
				) ?? null
			);
		},
		get todoFile() {
			const id = getWorkspaceId();
			if (id)
				return (
					queryClient.getQueryData<WorkspaceDestination>(workspaceQueryKeys.destination(id))
						?.todo_file ?? null
				);
			const current = session();
			return current.status === "ready" ? current.todo_file : null;
		},
		get undoLabel() {
			return confirmed()?.undoLabel;
		},
		get error() {
			const current = session();
			return (
				queryClient.getQueryState(workspaceQueryKeys.session)?.error?.message ??
				(current.status === "unavailable" ? current.error : "")
			);
		},
		get warning() {
			const current = session();
			return current.status === "empty" ? (current.warning ?? "") : "";
		},
		get savedViews() {
			return queryClient.getQueryData<readonly SavedView[]>(workspaceQueryKeys.views) ?? [];
		},
		get savedViewsError() {
			return queryClient.getQueryState(workspaceQueryKeys.views)?.error?.message ?? "";
		},
	};
}

// Model backend confirmations for isolated renderer tests.
export class WorkspaceSessionFixture extends WorkspaceCommands {
	initialize: WorkspaceCommands["restore"];
	private readonly clearQueries: () => void;
	readonly data: ReturnType<typeof workspaceFixtureData>;
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
		const queryClient = createFixtureQueryClient(adapter);
		const viewsLoaded = queryClient.query(workspaceViewsQuery(adapter)).catch(() => undefined);
		const sessionLoaded = queryClient.query(workspaceSessionQuery(adapter)).catch(() => undefined);
		super(
			adapter,
			queryClient,
			() => undefined,
			() => false,
			async () => onRefreshed()
		);
		this.data = workspaceFixtureData(queryClient);
		this.clearQueries = () => queryClient.clear();
		this.initialize = async () => {
			await sessionLoaded;
			const outcome = await this.restore();
			await viewsLoaded;
			return outcome;
		};
	}
	override destroy() {
		super.destroy();
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
