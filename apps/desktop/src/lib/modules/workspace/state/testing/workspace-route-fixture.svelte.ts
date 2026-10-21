import type {
	ConfirmedSession,
	DesktopAPI,
	DesktopOperation,
	DesktopRequest,
	DesktopResponse,
	TodoFileObservation,
} from "@tuxedo/contracts";
import { WorkspaceCommands } from "../workspace-commands.svelte";
import {
	readCatalogue,
	readWorkspace,
	type CatalogueData,
	type WorkspaceData,
} from "../workspace-route-data";

// A typed in-memory desktop boundary for UI tests; route resources are published independently.
export function workspaceRouteFixture(desktop: DesktopAPI) {
	let backend: ConfirmedSession | undefined;
	let catalogue = $state.raw<CatalogueData>();
	let workspace = $state.raw<WorkspaceData>();
	let destination = $state<string>();
	async function invoke<K extends DesktopOperation>(
		operation: K,
		request: DesktopRequest<K>
	): Promise<DesktopResponse<K>> {
		const result = await desktop[operation](request as never);
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
		readWorkspaceCatalogue: async () =>
			backend && backend.session.status !== "unavailable"
				? { status: "ready", catalogue: backend.session.catalogue, selection: selection() }
				: {
						status: "rejected",
						reason: "catalogue",
						message:
							backend?.session.status === "unavailable" ? backend.session.error : "Not loaded",
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
	async function publish(id = destination, shared = true) {
		if (shared) catalogue = await readCatalogue(boundary, () => catalogue);
		if (id) workspace = await readWorkspace(boundary, id, () => workspace);
	}
	const commands = new WorkspaceCommands(boundary, {
		catalogue: () => catalogue,
		workspace: () => workspace,
		destination: () => destination,
		navigating: () => false,
		refresh: (id, shared) => publish(id ?? undefined, shared),
		navigate: async (id) => {
			destination = id ?? undefined;
			await publish();
			await commands.committedDestination(destination);
		},
	});
	return {
		commands,
		observe: (observation: TodoFileObservation): TodoFileObservation => ({
			onTodoFileChanged: (listener) =>
				observation.onTodoFileChanged((event) => {
					const current = selection();
					if (
						!current ||
						current.scope !== event.scope ||
						current.workspaceId !== event.workspaceId ||
						current.todoPath !== event.todoPath ||
						current.revision > event.revision
					)
						return;
					void desktop.restoreSession({}).then((next) => {
						backend = next;
						listener({ ...event, revision: next.revision });
					});
				}),
		}),
		start: async () => {
			backend = await desktop.restoreSession({});
			destination = selection()?.workspaceId ?? undefined;
			commands.destinationError =
				backend.session.status === "empty" ? (backend.session.warning ?? "") : "";
			await publish();
		},
		reload: async () => {
			backend = await desktop.restoreSession({});
			destination = selection()?.workspaceId ?? undefined;
			commands.destinationError =
				backend.session.status === "empty" ? (backend.session.warning ?? "") : "";
			await publish();
		},
		navigate: async (id: string) => {
			if (commands.isOperating) return { status: "rejected" as const, message: "Busy" };
			destination = id;
			await publish();
			return commands.committedDestination(id);
		},
	};
}
