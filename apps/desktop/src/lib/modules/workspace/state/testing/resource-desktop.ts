import type {
	ConfirmedSession,
	DesktopAPI,
	DesktopOperation,
	DesktopRequest,
	DesktopResponse,
} from "@tuxedo/contracts";

export type ResourceFixture = Partial<DesktopAPI> & {
	resourceState?: () => Promise<ConfirmedSession>;
};

// In-memory backend for UI tests. The renderer receives only public resource reads and operation results.
export function resourceDesktop(
	desktop: Omit<DesktopAPI, "readWorkspaceCatalogue" | "readWorkspace"> & ResourceFixture
): DesktopAPI {
	let backend: ConfirmedSession | undefined;
	async function invoke<K extends DesktopOperation>(
		operation: K,
		request: DesktopRequest<K>
	): Promise<DesktopResponse<K>> {
		const result = await desktop[operation]!(request as never);
		if (result && typeof result === "object" && "confirmed" in result) {
			const incoming = result.confirmed;
			if (backend && (incoming.scope !== backend.scope || incoming.revision < backend.revision))
				return result as DesktopResponse<K>;
			if ("session" in incoming) backend = incoming;
			else if (backend?.session.status === "ready")
				backend = {
					scope: incoming.scope,
					revision: incoming.revision,
					undoLabel: incoming.undoLabel,
					session: { ...backend.session, todo_file: incoming.todo_file },
				};
		}
		return result as DesktopResponse<K>;
	}
	const boundary: DesktopAPI = {
		...desktop,
		readWorkspaceCatalogue: async () => {
			const incoming = await desktop.resourceState?.();
			if (
				incoming &&
				(!backend || incoming.scope !== backend.scope || incoming.revision >= backend.revision)
			)
				backend = incoming;
			return backend && backend.session.status !== "unavailable"
				? { status: "ready", catalogue: backend.session.catalogue, selection: selection() }
				: {
						status: "rejected",
						reason: "catalogue",
						message:
							backend?.session.status === "unavailable" ? backend.session.error : "Not loaded",
					};
		},
		readWorkspace: async ({ workspaceId }) => {
			const session = backend?.session;
			const target =
				session && session.status !== "unavailable"
					? session.catalogue.workspaces.find((w) => w.id === workspaceId)
					: undefined;
			return target &&
				session?.status === "ready" &&
				session.catalogue.active_workspace_id === workspaceId &&
				session.todo_file.path === target.todo_path
				? {
						status: "ready",
						workspace: target,
						todo_file: session.todo_file,
						provenance: { status: "confirmed", selection: selection()! },
					}
				: {
						status: "rejected",
						reason: "todo-file",
						message:
							session?.status === "empty" ? session.warning || "No Todo file" : "Unavailable",
					};
		},
		createWorkspace: (input) => invoke("createWorkspace", input),
		deleteWorkspace: (input) => invoke("deleteWorkspace", input),
		switchWorkspace: (input) => invoke("switchWorkspace", input),
		setWorkspaceSortOrder: (input) => invoke("setWorkspaceSortOrder", input),
		setWorkspaceShowDeferred: (input) => invoke("setWorkspaceShowDeferred", input),
		setTodoCompletion: (input) => invoke("setTodoCompletion", input),
		bulkSetTodoCompletion: (input) => invoke("bulkSetTodoCompletion", input),
		bulkDeleteTodos: (input) => invoke("bulkDeleteTodos", input),
		createTodo: (input) => invoke("createTodo", input),
		editTodo: (input) => invoke("editTodo", input),
		deleteTodo: (input) => invoke("deleteTodo", input),
		reorderTodo: (input) => invoke("reorderTodo", input),
		undoTodo: (input) => invoke("undoTodo", input),
	};
	function selection() {
		if (!backend) return null;
		return {
			scope: backend.scope,
			revision: backend.revision,
			workspaceId:
				backend.session.status === "ready" ? backend.session.catalogue.active_workspace_id : null,
			todoPath: backend.session.status === "ready" ? backend.session.todo_file.path : null,
			undoLabel: backend.undoLabel,
		};
	}
	return boundary;
}
