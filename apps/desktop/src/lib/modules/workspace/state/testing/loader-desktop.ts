import type { ConfirmedSession, ConfirmedTodo, DesktopAPI } from "@tuxedo/contracts";

// UI adapters model persisted backend state; only subsequent loader reads display it.
export function loaderDesktop(api: Omit<DesktopAPI, "readWorkspace">): DesktopAPI {
	let current: ConfirmedSession | undefined;
	const views = new Map<string, Awaited<ReturnType<DesktopAPI["readSavedViews"]>>>();
	const accept = (incoming: ConfirmedSession) => {
		if (!current || incoming.revision >= current.revision) current = incoming;
		return current;
	};
	async function remember<
		T extends { status: string; confirmed?: ConfirmedSession | ConfirmedTodo },
	>(result: Promise<T>): Promise<T> {
		const outcome = await result;
		if (outcome.confirmed) {
			const confirmed = outcome.confirmed;
			if ("session" in confirmed) accept(confirmed);
			else if (current?.session.status === "ready") {
				accept({
					scope: confirmed.scope,
					revision: confirmed.revision,
					...(confirmed.undoLabel ? { undoLabel: confirmed.undoLabel } : {}),
					session: { ...current.session, todo_file: confirmed.todo_file },
				});
			}
		}
		return outcome;
	}
	const desktop: DesktopAPI = {
		...api,
		readSession: async (request) => accept(await api.readSession(request)),
		refreshSession: async (request) => accept(await api.refreshSession(request)),
		readWorkspace: async (request) => {
			const snapshot = current ?? (await desktop.readSession({}));
			const session = snapshot.session;
			if (session.status !== "ready")
				return {
					status: "rejected",
					message:
						session.status === "empty" ? session.warning || "Todo file unavailable" : session.error,
				};
			const workspace = session.catalogue.workspaces.find((w) => w.id === request.workspaceId);
			if (!workspace) return { status: "rejected", message: "Workspace does not exist." };
			return {
				status: "ready",
				workspace,
				todo_file:
					workspace.id === session.catalogue.active_workspace_id
						? session.todo_file
						: { path: workspace.todo_path, items: [], skipped: [] },
				confirmation:
					workspace.id === session.catalogue.active_workspace_id
						? {
								scope: snapshot.scope,
								revision: snapshot.revision,
								...(snapshot.undoLabel ? { undoLabel: snapshot.undoLabel } : {}),
							}
						: null,
			};
		},
		readSavedViews: async (request) => {
			const outcome = await api.readSavedViews(request);
			return outcome.status === "applied" ? (views.get(request.workspaceId) ?? outcome) : outcome;
		},
		saveView: async (request) => {
			const outcome = await api.saveView(request);
			if (outcome.status === "applied") views.set(request.workspaceId, outcome);
			return outcome;
		},
		deleteView: async (request) => {
			const outcome = await api.deleteView(request);
			if (outcome.status === "applied") views.set(request.workspaceId, outcome);
			return outcome;
		},
		createWorkspace: (request) => remember(api.createWorkspace(request)),
		switchWorkspace: (request) => remember(api.switchWorkspace(request)),
		deleteWorkspace: (request) => remember(api.deleteWorkspace(request)),
		setWorkspaceSortOrder: (request) => remember(api.setWorkspaceSortOrder(request)),
		setWorkspaceShowDeferred: (request) => remember(api.setWorkspaceShowDeferred(request)),
		undoTodo: (request) => remember(api.undoTodo(request)),
		setTodoCompletion: (request) => remember(api.setTodoCompletion(request)),
		bulkSetTodoCompletion: (request) => remember(api.bulkSetTodoCompletion(request)),
		bulkDeleteTodos: (request) => remember(api.bulkDeleteTodos(request)),
		editTodo: (request) => remember(api.editTodo(request)),
		deleteTodo: (request) => remember(api.deleteTodo(request)),
		reorderTodo: (request) => remember(api.reorderTodo(request)),
		moveTodoOnBoard: (request) => remember(api.moveTodoOnBoard(request)),
		createTodo: (request) => remember(api.createTodo(request)),
	};
	return desktop;
}
