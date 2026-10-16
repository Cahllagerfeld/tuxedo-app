import { createActor, type ActorRefFrom, type SnapshotFrom } from "xstate";
import {
	type DesktopAPI,
	type DesktopRequest,
	type TodoSortOrder,
	type SavedViewFilterValues,
	type TodoFileObservation,
	todoFileChangeEvent,
} from "$lib/shared/desktop/contract";
import type { TodoItem } from "$lib/modules/todo/domain/todo";
import type {
	WorkspaceSessionActionResult,
	WorkspaceSessionOperation,
	WorkspaceSessionOperationTarget,
} from "./workspace-session-types";
import {
	workspaceSessionMachine,
	type WorkspaceSessionCommand,
	type CreateTodoDraft,
} from "./workspace-session-machine";

export type { CreateTodoDraft } from "./workspace-session-machine";
export { reconcileConfirmedSession, reconcileConfirmedTodo } from "./workspace-session-machine";

export class ElectronWorkspaceSessionState {
	private readonly actor: ActorRefFrom<typeof workspaceSessionMachine>;
	private snapshot: SnapshotFrom<typeof workspaceSessionMachine>;
	private initialization: Promise<WorkspaceSessionActionResult> | undefined;

	constructor(desktop: DesktopAPI) {
		this.actor = createActor(workspaceSessionMachine, { input: { desktop } });
		this.snapshot = $state.raw(this.actor.getSnapshot());
		this.actor.subscribe((snapshot) => {
			this.snapshot = snapshot;
		});
		// The actor owns no external resources and lives with this controller.
		this.actor.start();
	}

	private get confirmed() {
		return this.snapshot.context.confirmed;
	}
	private get readError() {
		return this.snapshot.context.readError;
	}
	get savedViews() {
		return this.snapshot.context.savedViews;
	}
	get savedViewsError() {
		return this.snapshot.context.savedViewsError;
	}
	observe = (observation: TodoFileObservation, onSummaryChanged: () => void) => {
		let listening = true;
		const unsubscribe = observation.onTodoFileChanged((event) => {
			const parsed = todoFileChangeEvent.payload.safeParse(event);
			const previous = this.confirmed;
			if (
				!listening ||
				!parsed.success ||
				this.isOperating ||
				!previous ||
				previous.session.status !== "ready" ||
				previous.scope !== parsed.data.scope ||
				previous.revision !== parsed.data.revision ||
				previous.session.catalogue.active_workspace_id !== parsed.data.workspaceId ||
				previous.session.todo_file.path !== parsed.data.todoPath
			)
				return;
			const before = JSON.stringify({
				items: previous.session.todo_file.items,
				skipped: previous.session.todo_file.skipped,
			});
			void this.restore().then((outcome) => {
				const file = this.todoFile;
				if (
					listening &&
					outcome.status === "applied" &&
					file &&
					before !== JSON.stringify({ items: file.items, skipped: file.skipped })
				)
					onSummaryChanged();
			});
		});
		return () => {
			listening = false;
			unsubscribe();
		};
	};

	get session() {
		return (
			this.confirmed?.session ??
			(this.readError !== null
				? { status: "unavailable" as const, error: this.readError }
				: { status: "loading" as const })
		);
	}
	get isLoading() {
		return this.session.status === "loading";
	}
	get undoLabel() {
		return this.session.status === "ready" ? this.confirmed?.undoLabel : undefined;
	}
	get pendingOperation(): WorkspaceSessionOperation | null {
		return this.snapshot.context.request?.command.operation ?? null;
	}
	get pendingTarget(): WorkspaceSessionOperationTarget | null {
		return this.snapshot.context.target ?? null;
	}
	get isOperating() {
		return this.snapshot.matches("running");
	}
	get catalogue() {
		return this.session.status === "empty" || this.session.status === "ready"
			? this.session.catalogue
			: null;
	}
	get activeWorkspace() {
		return (
			this.catalogue?.workspaces.find((w) => w.id === this.catalogue?.active_workspace_id) ?? null
		);
	}
	get todoFile() {
		return this.session.status === "ready" ? this.session.todo_file : null;
	}
	get error() {
		return this.session.status === "unavailable" ? this.session.error : "";
	}
	get warning() {
		return this.session.status === "empty" ? (this.session.warning ?? "") : "";
	}

	initialize = () =>
		(this.initialization ??= this.restore().then((outcome) => {
			if (outcome.status !== "applied" && !this.confirmed)
				this.actor.send({ type: "STARTUP_FAILED", message: outcome.message });
			return outcome;
		}));

	private request(command: WorkspaceSessionCommand): Promise<WorkspaceSessionActionResult> {
		return new Promise((reply) => {
			this.actor.send({ type: "REQUEST", request: { command, reply } });
		});
	}

	restore = () => this.request({ operation: "restore" });
	create = (input: DesktopRequest<"createWorkspace">) =>
		this.request({ operation: "create_workspace", input });
	open = (workspaceId: string) => this.request({ operation: "open_workspace", workspaceId });
	deleteWorkspace = (workspaceId: string) =>
		this.request({ operation: "delete_workspace", workspaceId });
	undoTodo = () => this.request({ operation: "undo_todo_change" });
	setSortOrder = (sortOrder: TodoSortOrder) =>
		this.request({ operation: "set_workspace_sort_order", sortOrder });
	setShowDeferred = (showDeferred: boolean) =>
		this.request({ operation: "set_workspace_show_deferred", showDeferred });
	saveView = (name: string, filters: SavedViewFilterValues) =>
		this.request({ operation: "save_view", name, filters });
	deleteView = (viewId: string) => this.request({ operation: "delete_view", viewId });
	setCompletion = (todo: TodoItem) => this.request({ operation: "set_todo_item_completion", todo });
	editTodo = (todo: TodoItem, draft: CreateTodoDraft) =>
		this.request({ operation: "edit_todo_item", todo, draft });
	deleteTodo = (todo: TodoItem) => this.request({ operation: "delete_todo_item", todo });
	reorderTodo = (items: readonly TodoItem[]) =>
		this.request({ operation: "reorder_todo_items", items });
	createTodo = (draft: CreateTodoDraft) => this.request({ operation: "create_todo_item", draft });
}
