import { todoFileChangeEvent } from "@tuxedo/contracts";
import type {
	DesktopAPI,
	DesktopRequest,
	ConfirmedTodo,
	ConfirmedSession,
	TodoSortOrder,
	TodoFileChange,
	TodoFileObservation,
} from "@tuxedo/contracts";
import type { TodoItem } from "#lib/modules/todo/domain/todo.js";
import type {
	PendingWorkspaceSessionOperation,
	WorkspaceSessionActionResult,
	WorkspaceSessionOperation,
	WorkspaceSessionOperationTarget,
} from "./workspace-session-types";

export type WorkspaceRoutes = {
	destination: () => string | undefined;
	navigating: () => boolean;
	navigate: (workspaceId: string | null, replace?: boolean) => Promise<void>;
};
export type CreateTodoDraft = Omit<
	DesktopRequest<"createTodo">,
	"scope" | "revision" | "workspaceId"
>;
export type WorkspaceLoad = { value: ConfirmedSession | null; error: string };

class CommandValidationError extends Error {}

// The renderer keeps one confirmed resource; RPC results replace it before admission is released.
export class WorkspaceCommands {
	private value = $state.raw<ConfirmedSession>();
	private pending = $state<PendingWorkspaceSessionOperation | null>(null);
	private readFailure = $state("");
	private initialized = $state(false);
	private startupHandled = $state(false);
	private startupTarget = $state<string>();
	private handoff: string | null | undefined;
	private deferredDestination = false;
	destinationError = $state("");

	constructor(
		private readonly desktop: DesktopAPI,
		private readonly routes: WorkspaceRoutes
	) {}

	get catalogue() {
		return this.value?.session.status !== "unavailable"
			? (this.value?.session.catalogue ?? null)
			: null;
	}
	get activeWorkspace() {
		return (
			this.catalogue?.workspaces.find((w) => w.id === this.catalogue?.active_workspace_id) ?? null
		);
	}
	get todoFile() {
		return this.value?.session.status === "ready" &&
			this.activeWorkspace?.id === this.routes.destination()
			? this.value.session.todo_file
			: null;
	}
	get ready() {
		return !!this.todoFile && !this.readFailure;
	}
	get isOperating() {
		return this.pending !== null || this.routes.navigating();
	}
	get canMutate() {
		return this.ready && !this.isOperating;
	}
	get pendingOperation() {
		return this.pending?.operation ?? null;
	}
	get pendingTarget() {
		return this.pending?.target ?? null;
	}
	get isStarting() {
		return (
			!this.initialized ||
			(!this.startupHandled && !this.routes.destination()) ||
			!!this.startupTarget
		);
	}
	get isLoading() {
		return this.session.status === "loading";
	}
	get undoLabel() {
		return this.todoFile ? this.value?.undoLabel : undefined;
	}
	get error() {
		return this.readFailure;
	}
	get warning() {
		return (
			this.destinationError ||
			(this.value?.session.status === "empty" ? (this.value.session.warning ?? "") : "")
		);
	}
	get recoveryError() {
		return this.readFailure;
	}
	get writesBlocked() {
		return !this.canMutate;
	}
	get session(): ConfirmedSession["session"] | { status: "loading" } {
		if (!this.value)
			return this.readFailure
				? { status: "unavailable", error: this.readFailure }
				: { status: "loading" };
		return this.value.session;
	}

	private acceptSession(incoming: ConfirmedSession) {
		if (
			this.value &&
			(incoming.scope !== this.value.scope || incoming.revision < this.value.revision)
		)
			return false;
		if (incoming.session.status === "unavailable") {
			this.readFailure = incoming.session.error;
			if (!this.value) this.value = incoming;
			return false;
		}
		this.value = incoming;
		this.readFailure = "";
		return true;
	}
	acceptLoadedSession(resource: WorkspaceLoad) {
		this.initialized = true;
		if (resource.error) this.readFailure = resource.error;
		else if (resource.value && (!this.value || resource.value.revision > this.value.revision))
			this.acceptSession(resource.value);
	}
	private async readSession(refresh = false): Promise<WorkspaceSessionActionResult> {
		try {
			const incoming = await (refresh
				? this.desktop.refreshSession({})
				: this.desktop.readSession({}));
			if (!this.acceptSession(incoming))
				throw Error(
					this.readFailure || "The Workspace session changed. Refresh its current contents."
				);
			return { status: "applied" };
		} catch (error) {
			this.readFailure = error instanceof Error ? error.message : String(error);
			return { status: "rejected", message: this.readFailure };
		}
	}
	retry = () =>
		this.runAction("restore", async () => {
			const outcome = await this.readSession(true);
			if (
				outcome.status === "applied" &&
				this.routes.destination() &&
				(this.value?.session.status !== "ready" ||
					this.activeWorkspace?.id !== this.routes.destination())
			)
				await this.navigate(
					this.value?.session.status === "ready" ? this.activeWorkspace!.id : null,
					true
				);
			return outcome;
		});

	async runAction(
		operation: WorkspaceSessionOperation,
		action: () => Promise<WorkspaceSessionActionResult>,
		target: WorkspaceSessionOperationTarget | null = null,
		committed = false
	): Promise<WorkspaceSessionActionResult> {
		if (this.pending || (!committed && this.routes.navigating()))
			return { status: "rejected", message: "A Workspace session operation is already running." };
		this.pending = { operation, target };
		try {
			return await action();
		} catch (error) {
			// A lost RPC response may follow a committed write. Recover by reading, never resubmitting it.
			const message = error instanceof Error ? error.message : String(error);
			if (!(error instanceof CommandValidationError)) this.readFailure = message;
			return { status: "rejected", message };
		} finally {
			this.pending = null;
			if (this.deferredDestination) {
				this.deferredDestination = false;
				await this.committedDestination(this.routes.destination());
			} else void this.drainObservation();
		}
	}
	private todoTarget() {
		if (!this.ready || !this.value || !this.activeWorkspace)
			throw new CommandValidationError("Refresh the Workspace before changing Todo items.");
		return {
			scope: this.value.scope,
			revision: this.value.revision,
			workspaceId: this.activeWorkspace.id,
		};
	}
	private todoOutcome(
		outcome: Awaited<ReturnType<DesktopAPI["deleteTodo"]>>
	): WorkspaceSessionActionResult {
		if (outcome.status === "rejected") return outcome;
		const incoming: ConfirmedTodo = outcome.confirmed;
		const current = this.value;
		if (
			current?.session.status === "ready" &&
			incoming.scope === current.scope &&
			incoming.revision >= current.revision &&
			incoming.workspaceId === current.session.catalogue.active_workspace_id &&
			incoming.todo_file.path === current.session.todo_file.path
		) {
			this.value = {
				scope: incoming.scope,
				revision: incoming.revision,
				...(incoming.undoLabel ? { undoLabel: incoming.undoLabel } : {}),
				session: { ...current.session, todo_file: incoming.todo_file },
			};
			this.readFailure = "";
		}
		return outcome.status === "conflict"
			? { status: "conflict", message: outcome.message }
			: { status: "applied", ...(outcome.notice ? { notice: outcome.notice } : {}) };
	}
	private sessionOutcome(
		outcome: Awaited<ReturnType<DesktopAPI["createWorkspace"]>>
	): WorkspaceSessionActionResult {
		if (outcome.status !== "applied") return outcome;
		this.acceptSession(outcome.confirmed);
		return { status: "applied" };
	}

	// Native navigating covers superseded loads too; only committed navigation may activate a Workspace.
	beginNavigation(_complete: Promise<void>, destination: string | undefined) {
		return !this.pending || this.handoff === (destination ?? null);
	}
	private async navigate(id: string | null, replace = false) {
		this.handoff = id;
		try {
			await this.routes.navigate(id, replace);
		} finally {
			this.handoff = undefined;
		}
	}
	committedDestination = async (
		workspaceId: string | undefined,
		initial = false
	): Promise<WorkspaceSessionActionResult | undefined> => {
		if (workspaceId !== this.routes.destination()) return;
		if (!this.initialized) return;
		if (workspaceId === this.startupTarget) this.startupTarget = undefined;
		if (!this.startupHandled) {
			this.startupHandled = true;
			if (initial && !workspaceId) {
				const active =
					this.value?.session.status === "ready" ? this.activeWorkspace?.id : undefined;
				if (active) {
					this.startupTarget = active;
					try {
						await this.navigate(active, true);
					} catch (error) {
						this.destinationError = error instanceof Error ? error.message : String(error);
					} finally {
						this.startupTarget = undefined;
					}
				}
				return;
			}
		}
		if (!workspaceId || this.ready) return this.drainObservation(true);
		if (this.pending) {
			this.deferredDestination = true;
			return;
		}
		return this.runAction(
			"open_workspace",
			async () => {
				if (this.activeWorkspace?.id === workspaceId && this.value?.session.status === "ready")
					return this.readSession();
				const outcome = await this.desktop.switchWorkspace({ workspaceId });
				if (outcome.status === "applied") this.acceptSession(outcome.confirmed);
				if (workspaceId !== this.routes.destination())
					return { status: "rejected", message: "Destination changed." };
				if (outcome.status === "rejected") {
					this.destinationError = outcome.message;
					await this.navigate(null, true);
					return outcome;
				}
				this.destinationError = "";
				return { status: "applied" };
			},
			{ workspaceId },
			true
		);
	};

	private catalogueTarget() {
		if (!this.catalogue || this.readFailure)
			throw new CommandValidationError("Refresh Workspaces before changing them.");
	}
	create = (input: DesktopRequest<"createWorkspace">) =>
		this.runAction(
			"create_workspace",
			async () => {
				this.catalogueTarget();
				const outcome = await this.desktop.createWorkspace(input);
				if (outcome.status !== "applied") return outcome;
				this.acceptSession(outcome.confirmed);
				this.destinationError = "";
				try {
					await this.navigate(this.activeWorkspace?.id ?? null);
				} catch (error) {
					return {
						status: "applied",
						notice: `Workspace created, but its destination could not be opened. ${error instanceof Error ? error.message : String(error)}`,
					};
				}
				return { status: "applied" };
			},
			{ todoPath: input.todoPath }
		);
	deleteWorkspace = (workspaceId: string) =>
		this.runAction(
			"delete_workspace",
			async () => {
				this.catalogueTarget();
				const outcome = await this.desktop.deleteWorkspace({ workspaceId });
				if (outcome.status !== "applied") return outcome;
				this.acceptSession(outcome.confirmed);
				if (this.routes.destination() && this.activeWorkspace?.id !== this.routes.destination()) {
					try {
						await this.navigate(null, true);
					} catch (error) {
						return {
							status: "applied",
							notice: `Workspace removed, but its destination could not be opened. ${error instanceof Error ? error.message : String(error)}`,
						};
					}
				}
				return { status: "applied" };
			},
			{ workspaceId }
		);
	setSortOrder = (sortOrder: TodoSortOrder) =>
		this.runAction(
			"set_workspace_sort_order",
			async () =>
				this.sessionOutcome(
					await this.desktop.setWorkspaceSortOrder({ ...this.todoTarget(), sortOrder })
				),
			this.todoOperationTarget()
		);
	setShowDeferred = (showDeferred: boolean) =>
		this.runAction(
			"set_workspace_show_deferred",
			async () =>
				this.sessionOutcome(
					await this.desktop.setWorkspaceShowDeferred({ ...this.todoTarget(), showDeferred })
				),
			this.todoOperationTarget()
		);
	undoTodo = () =>
		this.runAction(
			"undo_todo_change",
			async () => this.todoOutcome(await this.desktop.undoTodo(this.todoTarget())),
			this.todoOperationTarget()
		);

	private dirty: { event: TodoFileChange; notify: () => void } | undefined;
	observe = (observation: TodoFileObservation, onSummaryChanged: () => void) => {
		let listening = true;
		const stop = observation.onTodoFileChanged((event) => {
			const parsed = todoFileChangeEvent.payload.safeParse(event);
			if (!listening || !parsed.success) return;
			if (
				this.value &&
				(parsed.data.scope !== this.value.scope || parsed.data.revision <= this.value.revision)
			)
				return;
			if (
				!this.pending &&
				!this.routes.navigating() &&
				this.value &&
				!this.matchesObservation(parsed.data)
			)
				return;
			if (!this.dirty || parsed.data.revision >= this.dirty.event.revision)
				this.dirty = {
					event: parsed.data,
					notify: () => {
						if (listening) onSummaryChanged();
					},
				};
			void this.drainObservation();
		});
		return () => {
			listening = false;
			this.dirty = undefined;
			stop();
		};
	};
	private matchesObservation(event: TodoFileChange) {
		return (
			this.value?.session.status === "ready" &&
			event.scope === this.value.scope &&
			event.workspaceId === this.activeWorkspace?.id &&
			event.todoPath === this.value.session.todo_file.path &&
			event.revision > this.value.revision
		);
	}
	private drainObservation(committed = false): Promise<WorkspaceSessionActionResult> | undefined {
		if (this.pending || (!committed && this.routes.navigating()) || !this.dirty || !this.value)
			return;
		const { event, notify } = this.dirty;
		this.dirty = undefined;
		if (!this.matchesObservation(event)) return;
		const summary = () =>
			this.value?.session.status === "ready"
				? JSON.stringify({
						items: this.value.session.todo_file.items,
						skipped: this.value.session.todo_file.skipped,
					})
				: "";
		const before = summary();
		return this.runAction(
			"restore",
			async () => {
				const outcome = await this.readSession();
				if (outcome.status === "applied") {
					if (this.routes.destination() && this.value?.session.status !== "ready") {
						this.destinationError = this.warning;
						await this.navigate(null, true);
					} else if (this.routes.destination() && before !== summary()) notify();
				}
				return outcome;
			},
			{ workspaceId: event.workspaceId },
			committed
		);
	}
	setCompletion = (todo: TodoItem) =>
		this.runAction(
			"set_todo_item_completion",
			async () => {
				const input = this.todoMutationTarget(todo);
				return this.todoOutcome(
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
				this.validateCurrentItems(items);
				return this.todoOutcome(
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
				this.validateCurrentItems(items);
				return this.todoOutcome(
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
	private validateCurrentItems(items: readonly TodoItem[]) {
		const current = new Map(this.todoFile?.items.map((item) => [item.line_number, item.raw]));
		if (items.some((item) => current.get(item.line_number) !== item.raw))
			throw new CommandValidationError(
				"The Todo file changed. Try again with its current Todo items."
			);
	}

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
				return this.todoOutcome(
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
				return this.todoOutcome(await this.desktop.deleteTodo(input));
			},
			this.todoOperationTarget(todo)
		);
	reorderTodo = (items: readonly TodoItem[]) =>
		this.runAction(
			"reorder_todo_items",
			async () => {
				const target = this.todoTarget();
				this.validateCurrentItems(items);
				return this.todoOutcome(
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
				return this.todoOutcome(await this.desktop.createTodo({ ...target, ...draft }));
			},
			this.todoOperationTarget()
		);
}
