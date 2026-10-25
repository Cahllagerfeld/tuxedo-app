import { todoFileChangeEvent } from "@tuxedo/contracts";
import type {
	DesktopAPI,
	DesktopRequest,
	TodoSortOrder,
	TodoFileChange,
	TodoFileObservation,
} from "@tuxedo/contracts";
import type { TodoItem } from "#lib/modules/todo/domain/todo.js";
import type { SessionData, WorkspaceData } from "./workspace-route-data";
import type {
	PendingWorkspaceSessionOperation,
	WorkspaceSessionActionResult,
	WorkspaceSessionOperation,
	WorkspaceSessionOperationTarget,
} from "./workspace-session-types";

export type WorkspaceRoutes = {
	session: () => SessionData | undefined;
	workspace: () => WorkspaceData | undefined;
	destination: () => string | undefined;
	navigating: () => boolean;
	refresh: (workspaceId: string | null, session?: boolean) => Promise<void>;
};
export type CreateTodoDraft = Omit<
	DesktopRequest<"createTodo">,
	"scope" | "revision" | "workspaceId"
>;
class CommandValidationError extends Error {}

// Displayed data comes from loaders. Commands retain only admission and recovery metadata.
export class WorkspaceCommands {
	private pending = $state<PendingWorkspaceSessionOperation | null>(null);
	private readFailure = $state("");
	private minimumRevision = $state(-1);
	private completion = Promise.resolve();

	constructor(
		private readonly desktop: DesktopAPI,
		private readonly routes: WorkspaceRoutes
	) {}
	private get current() {
		const data = this.routes.workspace();
		return data?.workspaceId === this.routes.destination() ? data : undefined;
	}
	private get confirmed() {
		return this.routes.session()?.value;
	}
	private get catalogue() {
		return this.confirmed?.session.status !== "unavailable"
			? (this.confirmed?.session.catalogue ?? null)
			: null;
	}
	private get activeWorkspace() {
		return this.catalogue?.workspaces.find(
			(workspace) => workspace.id === this.catalogue?.active_workspace_id
		);
	}
	private get todoFile() {
		return this.current?.value?.confirmation &&
			this.current.value.workspace.id === this.catalogue?.active_workspace_id
			? this.current.value.todo_file
			: null;
	}
	get ready() {
		const confirmation = this.current?.value?.confirmation;
		return (
			!!this.todoFile &&
			!this.recoveryError &&
			!!confirmation &&
			confirmation.scope === this.confirmed?.scope &&
			confirmation.revision >= Math.max(this.minimumRevision, this.confirmed?.revision ?? -1)
		);
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
	private get error() {
		return this.routes.session()?.error ?? "";
	}
	get recoveryError() {
		return this.readFailure || this.current?.error || this.error;
	}
	get writesBlocked() {
		return !this.canMutate;
	}
	private requireRevision(value: { scope: string; revision: number }) {
		if (this.confirmed && value.scope !== this.confirmed.scope)
			throw Error("The Workspace session changed. Refresh its current contents.");
		this.minimumRevision = Math.max(this.minimumRevision, value.revision);
	}
	private async refresh(
		workspaceId: string | null,
		session = false
	): Promise<WorkspaceSessionActionResult> {
		try {
			await this.routes.refresh(workspaceId, session);
			const displayed =
				workspaceId &&
				workspaceId === this.routes.destination() &&
				this.confirmed?.session.status === "ready" &&
				this.catalogue?.active_workspace_id === workspaceId;
			const failure = (displayed ? this.current?.error : "") || this.error;
			if (failure) throw Error(failure);
			const revision = displayed
				? this.current?.value?.confirmation?.revision
				: this.confirmed?.revision;
			if (revision === undefined || revision < this.minimumRevision)
				throw Error("Current Workspace data could not be refreshed. Retry the refresh.");
			this.readFailure = "";
			return { status: "applied" };
		} catch (error) {
			this.readFailure = error instanceof Error ? error.message : String(error);
			return { status: "rejected", message: this.readFailure };
		}
	}
	retry = () =>
		this.runAction("restore", async () => {
			const value = await this.desktop.refreshSession({});
			this.requireRevision(value);
			const activeWorkspaceId =
				value.session.status === "ready" ? value.session.catalogue.active_workspace_id : null;
			const outcome = await this.refresh(
				activeWorkspaceId === this.routes.destination() ? activeWorkspaceId : null,
				true
			);
			return outcome.status === "applied" ? { ...outcome, activeWorkspaceId } : outcome;
		});
	async whenIdle() {
		while (this.pending) await this.completion;
	}
	runAction(
		operation: WorkspaceSessionOperation,
		action: () => Promise<WorkspaceSessionActionResult>,
		target: WorkspaceSessionOperationTarget | null = null
	) {
		return this.run(operation, action, target);
	}
	private async run(
		operation: WorkspaceSessionOperation,
		action: () => Promise<WorkspaceSessionActionResult>,
		target: WorkspaceSessionOperationTarget | null = null,
		committed = false
	): Promise<WorkspaceSessionActionResult> {
		if (this.pending || (!committed && this.routes.navigating()))
			return { status: "rejected", message: "A Workspace session operation is already running." };
		this.pending = { operation, target };
		let finish!: () => void;
		this.completion = new Promise<void>((resolve) => {
			finish = resolve;
		});
		try {
			return await action();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!(error instanceof CommandValidationError)) this.readFailure = message;
			return { status: "rejected", message };
		} finally {
			this.pending = null;
			finish();
			void this.drainObservation();
		}
	}
	private todoTarget() {
		const confirmation = this.current?.value?.confirmation;
		if (!this.ready || !confirmation || !this.activeWorkspace)
			throw new CommandValidationError("Refresh the Workspace before changing Todo items.");
		return {
			scope: confirmation.scope,
			revision: confirmation.revision,
			workspaceId: this.activeWorkspace.id,
		};
	}
	private async todoOutcome(
		outcome: Awaited<ReturnType<DesktopAPI["deleteTodo"]>>
	): Promise<WorkspaceSessionActionResult> {
		if (outcome.status === "rejected") return outcome;
		this.requireRevision(outcome.confirmed);
		const refreshed = await this.refresh(outcome.confirmed.workspaceId);
		if (outcome.status === "conflict") return { status: "conflict", message: outcome.message };
		return {
			status: "applied",
			...(refreshed.status === "rejected"
				? { notice: "Change saved, but the Workspace could not be refreshed. " + refreshed.message }
				: outcome.notice
					? { notice: outcome.notice }
					: {}),
		};
	}
	private async sessionOutcome(
		outcome: Awaited<ReturnType<DesktopAPI["createWorkspace"]>>
	): Promise<WorkspaceSessionActionResult> {
		if (outcome.status !== "applied") return outcome;
		this.requireRevision(outcome.confirmed);
		const activeWorkspaceId =
			outcome.confirmed.session.status === "ready"
				? outcome.confirmed.session.catalogue.active_workspace_id
				: null;
		const refreshed = await this.refresh(
			activeWorkspaceId === this.routes.destination() ? activeWorkspaceId : null,
			true
		);
		return {
			status: "applied",
			...(refreshed.status === "rejected"
				? { notice: "Change saved, but the Workspace could not be refreshed. " + refreshed.message }
				: {}),
		};
	}
	activate = (workspaceId: string): Promise<WorkspaceSessionActionResult> =>
		this.run(
			"open_workspace",
			async () => {
				if (this.activeWorkspace?.id === workspaceId && this.current?.value?.confirmation)
					return this.refresh(workspaceId, true);
				const outcome = await this.desktop.switchWorkspace({ workspaceId });
				if (outcome.status !== "applied") return outcome;
				this.requireRevision(outcome.confirmed);
				return this.refresh(workspaceId === this.routes.destination() ? workspaceId : null, true);
			},
			{ workspaceId },
			true
		);
	flushObservation = () => this.drainObservation(true);
	private catalogueTarget() {
		if (!this.catalogue || this.recoveryError)
			throw new CommandValidationError("Refresh Workspaces before changing them.");
	}
	create = (input: DesktopRequest<"createWorkspace">) =>
		this.runAction(
			"create_workspace",
			async () => {
				this.catalogueTarget();
				const outcome = await this.desktop.createWorkspace(input);
				if (outcome.status !== "applied") return outcome;
				this.requireRevision(outcome.confirmed);
				const id =
					outcome.confirmed.session.status === "ready"
						? outcome.confirmed.session.catalogue.active_workspace_id
						: null;
				const refreshed = await this.refresh(null, true);
				return {
					status: "applied",
					workspaceId: id,
					...(refreshed.status === "rejected"
						? {
								notice:
									"Workspace created, but Workspaces could not be refreshed. " + refreshed.message,
							}
						: {}),
				};
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
				const active =
					outcome.confirmed.session.status === "ready"
						? outcome.confirmed.session.catalogue.active_workspace_id
						: null;
				return { ...(await this.sessionOutcome(outcome)), activeWorkspaceId: active };
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

	private summary() {
		return JSON.stringify({ items: this.todoFile?.items, skipped: this.todoFile?.skipped });
	}
	private dirty:
		{ event: TodoFileChange; before: string; notify: (changed: boolean) => void } | undefined;
	observe = (observation: TodoFileObservation, onUpdated: (changed: boolean) => void) => {
		let listening = true;
		const stop = observation.onTodoFileChanged((event) => {
			const parsed = todoFileChangeEvent.payload.safeParse(event);
			if (
				!listening ||
				!parsed.success ||
				!this.confirmed ||
				parsed.data.scope !== this.confirmed.scope
			)
				return;
			const revision = this.current?.value?.confirmation?.revision ?? this.confirmed.revision;
			if (parsed.data.revision <= revision) return;
			if (!this.pending && !this.routes.navigating() && !this.matchesObservation(parsed.data))
				return;
			if (!this.dirty || parsed.data.revision >= this.dirty.event.revision)
				this.dirty = {
					event: parsed.data,
					before: this.dirty?.before ?? this.summary(),
					notify: (changed) => {
						if (listening) onUpdated(changed);
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
			!!this.confirmed &&
			event.scope === this.confirmed.scope &&
			event.workspaceId === this.activeWorkspace?.id &&
			event.todoPath === this.activeWorkspace.todo_path
		);
	}
	private drainObservation(committed = false): Promise<WorkspaceSessionActionResult> | undefined {
		if (this.pending || (!committed && this.routes.navigating()) || !this.dirty) return;
		const { event, before, notify } = this.dirty;
		this.dirty = undefined;
		if (!this.matchesObservation(event)) return;
		const revision = this.current?.value?.confirmation?.revision;
		if (this.ready && revision !== undefined && revision >= event.revision) {
			notify(!!this.routes.destination() && before !== this.summary());
			return;
		}
		return this.run(
			"restore",
			async () => {
				this.requireRevision(event);
				const outcome = await this.refresh(this.routes.destination() ?? null, true);
				return outcome;
			},
			{ workspaceId: event.workspaceId },
			committed
		).then((outcome) => {
			notify(
				outcome.status === "applied" && !!this.routes.destination() && before !== this.summary()
			);
			return outcome;
		});
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
