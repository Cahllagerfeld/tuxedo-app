import {
	type SavedView,
	type TodoSortOrder,
	type SavedViewFilterValues,
	type ConfirmedSession,
	type DesktopAPI,
	type DesktopRequest,
	type TodoFileObservation,
	type TodoFileChange,
	todoFileChangeEvent,
} from "$lib/shared/desktop/contract";
import type {
	WorkspaceSessionActionResult,
	PendingWorkspaceSessionOperation,
	WorkspaceSessionOperation,
	WorkspaceSessionOperationTarget,
} from "./workspace-session-types";
import type { TodoItem } from "$lib/modules/todo/domain/todo";

type CreateTodoRequest = DesktopRequest<"createTodo">;
export type CreateTodoDraft = Omit<CreateTodoRequest, "scope" | "revision" | "workspaceId">;

export type WorkspaceLoadedData = {
	confirmed?: ConfirmedSession;
	error?: string;
	savedViews?: readonly SavedView[];
	savedViewsError?: string;
};

export class ElectronWorkspaceSessionState {
	private pending = $state<PendingWorkspaceSessionOperation | null>(null);
	private refreshFailed = $state(false);
	private reconsiderObservation: (() => void) | undefined;

	constructor(
		private readonly desktop: DesktopAPI,
		private readonly getData: () => WorkspaceLoadedData,
		private readonly invalidate: (dependency: "session" | "views" | "lifecycle") => Promise<void>
	) {}

	private get confirmed() {
		return this.getData().confirmed;
	}
	get savedViews() {
		return this.getData().savedViews ?? [];
	}
	get savedViewsError() {
		return this.getData().savedViewsError ?? "";
	}
	get refreshError() {
		return this.refreshFailed
			? "The screen could not refresh. Retry loading before making another change."
			: "";
	}

	observe = (observation: TodoFileObservation, onSummaryChanged: () => void) => {
		let listening = true;
		let deferred: TodoFileChange | undefined;
		const reconsider = () => {
			if (!listening || this.isOperating || !deferred) return;
			const event = deferred;
			deferred = undefined;
			const previous = this.confirmed;
			if (
				!previous ||
				previous.session.status !== "ready" ||
				previous.scope !== event.scope ||
				previous.revision !== event.revision ||
				previous.session.catalogue.active_workspace_id !== event.workspaceId ||
				previous.session.todo_file.path !== event.todoPath
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
		};
		this.reconsiderObservation = reconsider;
		const unsubscribe = observation.onTodoFileChanged((event) => {
			const parsed = todoFileChangeEvent.payload.safeParse(event);
			if (!listening || !parsed.success) return;
			deferred = parsed.data;
			reconsider();
		});
		return () => {
			listening = false;
			deferred = undefined;
			if (this.reconsiderObservation === reconsider) this.reconsiderObservation = undefined;
			unsubscribe();
		};
	};

	private async refreshOutcome<T extends WorkspaceSessionActionResult>(
		outcome: T,
		dependency: "session" | "views" | "lifecycle" = "session"
	): Promise<T & { notice?: string }> {
		if (outcome.status !== "rejected") {
			try {
				await this.invalidate(dependency);
				const error =
					dependency !== "views"
						? this.getData().error ||
							(this.session.status === "unavailable" ? this.session.error : "")
						: this.savedViewsError;
				if (error) throw Error(error);
				if (dependency !== "views") this.refreshFailed = false;
			} catch {
				if (dependency !== "views") this.refreshFailed = true;
				if (outcome.status === "applied")
					return {
						...outcome,
						notice:
							"Change saved, but the screen could not refresh. Retry loading before making another change.",
					};
			}
		}
		return outcome;
	}

	private applySessionOutcome = (outcome: Awaited<ReturnType<DesktopAPI["createWorkspace"]>>) =>
		this.refreshOutcome(outcome);
	private applyTodoOutcome = (outcome: Awaited<ReturnType<DesktopAPI["deleteTodo"]>>) =>
		this.refreshOutcome(outcome);

	private todoTarget(): Pick<CreateTodoRequest, "scope" | "revision" | "workspaceId"> {
		const confirmed = this.confirmed;
		if (
			this.refreshFailed ||
			!confirmed ||
			confirmed.session.status !== "ready" ||
			!confirmed.session.catalogue.active_workspace_id
		)
			throw Error("No Active workspace Todo file is loaded.");
		return {
			scope: confirmed.scope,
			revision: confirmed.revision,
			workspaceId: confirmed.session.catalogue.active_workspace_id,
		};
	}

	get session() {
		return (
			this.confirmed?.session ??
			(this.getData().error
				? { status: "unavailable" as const, error: this.getData().error! }
				: { status: "loading" as const })
		);
	}
	get isLoading() {
		return this.session.status === "loading";
	}
	get undoLabel() {
		return this.session.status === "ready" ? this.confirmed?.undoLabel : undefined;
	}
	undoTodo = () =>
		this.runAction(
			"undo_todo_change",
			async () => this.applyTodoOutcome(await this.desktop.undoTodo(this.todoTarget())),
			this.todoOperationTarget()
		);
	setSortOrder = (sortOrder: TodoSortOrder) =>
		this.runAction(
			"set_workspace_sort_order",
			async () =>
				this.applySessionOutcome(
					await this.desktop.setWorkspaceSortOrder({ ...this.todoTarget(), sortOrder })
				),
			this.todoOperationTarget()
		);
	setShowDeferred = (showDeferred: boolean) =>
		this.runAction(
			"set_workspace_show_deferred",
			async () =>
				this.applySessionOutcome(
					await this.desktop.setWorkspaceShowDeferred({ ...this.todoTarget(), showDeferred })
				),
			this.todoOperationTarget()
		);
	get pendingOperation(): WorkspaceSessionOperation | null {
		return this.pending?.operation ?? null;
	}
	get pendingTarget(): WorkspaceSessionOperationTarget | null {
		return this.pending?.target ?? null;
	}
	get isOperating() {
		return this.pending !== null;
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
	private async runAction(
		operation: WorkspaceSessionOperation,
		action: () => Promise<WorkspaceSessionActionResult>,
		target: WorkspaceSessionOperationTarget | null = null
	): Promise<WorkspaceSessionActionResult> {
		if (this.isOperating)
			return { status: "rejected", message: "A Workspace session operation is already running." };
		// Admission and pending UI share one synchronous state transition.
		this.pending = { operation, target };
		try {
			const outcome = await action();
			return outcome.status === "applied"
				? {
						status: "applied",
						...(outcome.notice ? { notice: outcome.notice } : {}),
						...(outcome.workspaceId ? { workspaceId: outcome.workspaceId } : {}),
					}
				: { status: outcome.status, message: outcome.message };
		} catch (error) {
			return {
				status: "rejected",
				message: error instanceof Error ? error.message : String(error),
			};
		} finally {
			this.pending = null;
			this.reconsiderObservation?.();
		}
	}
	restore = () =>
		this.runAction("restore", async () => {
			await this.desktop.restoreSession({});
			await this.invalidate("session");
			this.refreshFailed = !!this.getData().error;
			return { status: "applied" };
		});

	reload = (includeViews = false) =>
		this.runAction("restore", async () => {
			await this.invalidate(includeViews ? "lifecycle" : "session");
			this.refreshFailed = !!this.getData().error;
			return { status: "applied" };
		});
	reloadViews = () =>
		this.runAction(
			"reload_views",
			async () => {
				await this.invalidate("views");
				return this.savedViewsError
					? { status: "rejected", message: this.savedViewsError }
					: { status: "applied" };
			},
			this.todoOperationTarget()
		);

	saveView = (name: string, filters: SavedViewFilterValues) =>
		this.runAction(
			"save_view",
			async () => {
				const workspaceId = this.activeWorkspace?.id;
				if (!workspaceId) return { status: "rejected", message: "Open a Workspace first." };
				const outcome = await this.desktop.saveView({ workspaceId, name, filters });
				return this.refreshOutcome(outcome, "views");
			},
			this.todoOperationTarget()
		);
	deleteView = (viewId: string) =>
		this.runAction(
			"delete_view",
			async () => {
				const workspaceId = this.activeWorkspace?.id;
				if (!workspaceId) return { status: "rejected", message: "Open a Workspace first." };
				const outcome = await this.desktop.deleteView({ workspaceId, viewId });
				return this.refreshOutcome(outcome, "views");
			},
			this.todoOperationTarget()
		);

	create = (input: DesktopRequest<"createWorkspace">) =>
		this.runAction(
			"create_workspace",
			async () => {
				const outcome = await this.refreshOutcome(
					await this.desktop.createWorkspace(input),
					"lifecycle"
				);
				return outcome.status === "applied"
					? ({
							status: "applied",
							workspaceId:
								outcome.confirmed.session.status === "ready"
									? outcome.confirmed.session.catalogue.active_workspace_id!
									: undefined,
							...(outcome.notice ? { notice: outcome.notice } : {}),
						} as const)
					: outcome;
			},
			{ todoPath: input.todoPath }
		);
	open = (workspaceId: string, refresh = true) =>
		this.runAction(
			"open_workspace",
			async () => {
				const outcome = await this.desktop.switchWorkspace({ workspaceId });
				return refresh ? this.refreshOutcome(outcome, "lifecycle") : outcome;
			},
			{ workspaceId }
		);
	deleteWorkspace = (workspaceId: string) =>
		this.runAction(
			"delete_workspace",
			async () =>
				this.refreshOutcome(await this.desktop.deleteWorkspace({ workspaceId }), "lifecycle"),
			{ workspaceId }
		);
	setCompletion = (todo: TodoItem) =>
		this.runAction(
			"set_todo_item_completion",
			async () => {
				const input = this.todoMutationTarget(todo);
				return this.applyTodoOutcome(
					await this.desktop.setTodoCompletion({ ...input, completed: !todo.completed })
				);
			},
			this.todoOperationTarget(todo)
		);
	bulkSetCompletion = (items: readonly TodoItem[], completed: boolean) =>
		this.runAction(
			"bulk_set_todo_item_completion",
			async () => {
				const target = this.todoTarget();
				const current = new Map(this.todoFile?.items.map((item) => [item.line_number, item.raw]));
				if (items.some((item) => current.get(item.line_number) !== item.raw))
					return {
						status: "rejected",
						message: "The Todo file changed. Try again with its current Todo items.",
					};
				return this.applyTodoOutcome(
					await this.desktop.bulkSetTodoCompletion({
						...target,
						completed,
						targets: items.map((item) => ({
							lineNumber: item.line_number,
							expectedRaw: item.raw,
						})),
					})
				);
			},
			this.todoOperationTarget()
		);
	bulkDeleteTodos = (items: readonly TodoItem[]) =>
		this.runAction(
			"bulk_delete_todo_items",
			async () => {
				const target = this.todoTarget();
				const current = new Map(this.todoFile?.items.map((item) => [item.line_number, item.raw]));
				if (items.some((item) => current.get(item.line_number) !== item.raw))
					return {
						status: "rejected",
						message: "The Todo file changed. Try again with its current Todo items.",
					};
				return this.applyTodoOutcome(
					await this.desktop.bulkDeleteTodos({
						...target,
						targets: items.map((item) => ({
							lineNumber: item.line_number,
							expectedRaw: item.raw,
						})),
					})
				);
			},
			this.todoOperationTarget()
		);
	private todoMutationTarget(todo: TodoItem): DesktopRequest<"deleteTodo"> {
		return { ...this.todoTarget(), lineNumber: todo.line_number, expectedRaw: todo.raw };
	}
	private todoOperationTarget(todo?: TodoItem): WorkspaceSessionOperationTarget | null {
		const workspaceId = this.catalogue?.active_workspace_id;
		return workspaceId ? { workspaceId, ...(todo ? { lineNumber: todo.line_number } : {}) } : null;
	}
	editTodo = (todo: TodoItem, draft: CreateTodoDraft) =>
		this.runAction(
			"edit_todo_item",
			async () => {
				const target = this.todoMutationTarget(todo);
				return this.applyTodoOutcome(
					await this.desktop.editTodo({
						...draft,
						...target,
						creationDate: draft.creationDate ?? null,
						completed: draft.completed ?? todo.completed,
					})
				);
			},
			this.todoOperationTarget(todo)
		);
	deleteTodo = (todo: TodoItem) =>
		this.runAction(
			"delete_todo_item",
			async () => {
				const input = this.todoMutationTarget(todo);
				return this.applyTodoOutcome(await this.desktop.deleteTodo(input));
			},
			this.todoOperationTarget(todo)
		);
	reorderTodo = (items: readonly TodoItem[]) =>
		this.runAction(
			"reorder_todo_items",
			async () => {
				const target = this.todoTarget();
				const current = new Map(this.todoFile?.items.map((item) => [item.line_number, item.raw]));
				if (items.some((item) => current.get(item.line_number) !== item.raw))
					return {
						status: "rejected",
						message: "The Todo file changed. Try again with its current Todo items.",
					};
				return this.applyTodoOutcome(
					await this.desktop.reorderTodo({
						...target,
						lineNumbers: items.map((item) => item.line_number),
					})
				);
			},
			this.todoOperationTarget()
		);
	createTodo = (draft: CreateTodoDraft) =>
		this.runAction(
			"create_todo_item",
			async () => {
				const target = this.todoTarget();
				return this.applyTodoOutcome(await this.desktop.createTodo({ ...target, ...draft }));
			},
			this.todoOperationTarget()
		);
}
