import { todoFileChangeEvent } from "@tuxedo/contracts";
import { tick } from "svelte";
import type {
	DesktopAPI,
	DesktopRequest,
	WorkspaceSelection,
	ConfirmedTodo,
	ConfirmedSession,
	TodoSortOrder,
	TodoFileChange,
	TodoFileObservation,
} from "@tuxedo/contracts";
import type { TodoItem } from "$lib/modules/todo/domain/todo";
import type { CatalogueData, WorkspaceData } from "./workspace-route-data";
import type {
	PendingWorkspaceSessionOperation,
	WorkspaceSessionActionResult,
	WorkspaceSessionOperation,
	WorkspaceSessionOperationTarget,
} from "./workspace-session-types";

export type WorkspaceRoutes = {
	catalogue: () => CatalogueData | undefined;
	workspace: () => WorkspaceData | undefined;
	destination: () => string | undefined;
	navigating: () => boolean;
	refresh: (workspaceId: string | null, catalogue: boolean) => Promise<void>;
	navigate: (workspaceId: string | null, replace?: boolean) => Promise<void>;
};
export type CreateTodoDraft = Omit<
	DesktopRequest<"createTodo">,
	"scope" | "revision" | "workspaceId"
>;

// Commands keep admission and receipts. All displayed backend data belongs to the router.
export class WorkspaceCommands {
	private pending = $state<PendingWorkspaceSessionOperation | null>(null);
	private required = $state<WorkspaceSelection>();
	private refreshFailure = $state("");
	constructor(
		private readonly desktop: DesktopAPI,
		private readonly routes: WorkspaceRoutes
	) {}
	private get current() {
		const data = this.routes.workspace();
		return data?.workspaceId === this.routes.destination() ? data : undefined;
	}
	get catalogue() {
		return this.routes.catalogue()?.value?.catalogue ?? null;
	}
	get activeWorkspace() {
		return (
			(this.todoFile ? this.current?.value?.workspace : null) ??
			this.catalogue?.workspaces.find((w) => w.id === this.catalogue?.active_workspace_id) ??
			null
		);
	}
	get todoFile() {
		return this.current?.value?.provenance.status === "confirmed" &&
			this.catalogue?.active_workspace_id === this.current.value.workspace.id
			? this.current.value.todo_file
			: null;
	}
	private get selection() {
		const provenance = this.current?.value?.provenance;
		return provenance?.status === "confirmed" ? provenance.selection : undefined;
	}
	private matches(selection: WorkspaceSelection | undefined | null, required: WorkspaceSelection) {
		return (
			!!selection &&
			selection.scope === required.scope &&
			selection.revision >= required.revision &&
			selection.workspaceId === required.workspaceId &&
			selection.todoPath === required.todoPath
		);
	}
	get ready() {
		const current = this.current;
		const selection = this.selection;
		return (
			!!current?.value &&
			!current.error &&
			!this.routes.catalogue()?.error &&
			!this.refreshFailure &&
			!!selection &&
			selection.workspaceId === this.routes.destination() &&
			this.catalogue?.active_workspace_id === selection.workspaceId &&
			(!this.required || this.matches(selection, this.required))
		);
	}
	get isOperating() {
		return this.pending !== null || this.navigationPending || this.routes.navigating();
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
	private todoTarget() {
		if (!this.ready || !this.selection?.workspaceId)
			throw Error("Refresh the Workspace before changing Todo items.");
		const { scope, revision, workspaceId } = this.selection;
		return { scope, revision, workspaceId };
	}
	async runAction(
		operation: WorkspaceSessionOperation,
		action: () => Promise<WorkspaceSessionActionResult>,
		target: WorkspaceSessionOperationTarget | null = null,
		committed = false
	): Promise<WorkspaceSessionActionResult> {
		if (this.pending || this.navigationPending || (!committed && this.routes.navigating()))
			return { status: "rejected", message: "A Workspace session operation is already running." };
		this.pending = { operation, target };
		try {
			return await action();
		} catch (error) {
			return {
				status: "rejected",
				message: error instanceof Error ? error.message : String(error),
			};
		} finally {
			this.pending = null;
			this.drainObservation();
		}
	}
	private async refresh(workspaceId: string | null, catalogue = false) {
		try {
			await this.routes.refresh(workspaceId, catalogue);
			await tick();
			const selection = workspaceId ? this.selection : this.routes.catalogue()?.value?.selection;
			if (
				this.current?.error ||
				(catalogue &&
					(this.routes.catalogue()?.error ||
						!this.required ||
						!this.matches(this.routes.catalogue()?.value?.selection, this.required))) ||
				!this.required ||
				!this.matches(selection, this.required)
			)
				throw Error(
					this.current?.error ||
						this.routes.catalogue()?.error ||
						"Confirmed data has not reached the screen. Retry the refresh."
				);
			this.refreshFailure = "";
			this.refreshCatalogue = false;
			return { status: "applied" as const };
		} catch (error) {
			this.refreshFailure = error instanceof Error ? error.message : String(error);
			return { status: "rejected" as const, message: this.refreshFailure };
		}
	}
	private async todoOutcome(outcome: Awaited<ReturnType<DesktopAPI["deleteTodo"]>>) {
		if (outcome.status === "rejected") return outcome;
		const value: ConfirmedTodo = outcome.confirmed;
		this.refreshCatalogue = false;
		this.required = {
			scope: value.scope,
			revision: value.revision,
			workspaceId: value.workspaceId,
			todoPath: value.todo_file.path,
		};
		const refreshed = await this.refresh(value.workspaceId);
		if (refreshed.status !== "applied")
			return outcome.status === "conflict"
				? {
						status: "conflict" as const,
						message: `${outcome.message} The screen could not be refreshed. ${refreshed.message}`,
					}
				: {
						status: "applied" as const,
						notice: `Change saved, but the Workspace could not be refreshed. ${refreshed.message}`,
					};
		return outcome.status === "conflict"
			? { status: "conflict" as const, message: outcome.message }
			: { status: "applied" as const, ...(outcome.notice ? { notice: outcome.notice } : {}) };
	}
	retry = () =>
		this.runAction("restore", async () => {
			if (!this.required) {
				await this.routes.refresh(this.routes.destination() ?? null, true);
				await tick();
				return this.recoveryError
					? { status: "rejected", message: this.recoveryError }
					: { status: "applied" };
			}
			if (this.routes.destination() && this.routes.destination() !== this.required.workspaceId)
				await this.navigate(this.required.workspaceId, true);
			return this.refresh(
				this.routes.destination() === this.required.workspaceId ? this.required.workspaceId : null,
				this.refreshCatalogue || !this.routes.destination()
			);
		});
	get session(): ConfirmedSession["session"] | { status: "loading" } {
		const catalogue = this.catalogue;
		if (!catalogue)
			return this.routes.catalogue()?.error
				? { status: "unavailable", error: this.routes.catalogue()!.error }
				: { status: "loading" };
		return this.todoFile
			? { status: "ready", catalogue, todo_file: this.todoFile }
			: { status: "empty", catalogue, warning: this.destinationError || null };
	}
	get isLoading() {
		return this.session.status === "loading";
	}
	get undoLabel() {
		return this.selection?.undoLabel;
	}
	get error() {
		return this.routes.catalogue()?.error ?? "";
	}
	get warning() {
		return this.destinationError;
	}
	get recoveryError() {
		return this.refreshFailure || this.current?.error || this.routes.catalogue()?.error || "";
	}
	get writesBlocked() {
		return !this.canMutate;
	}
	destinationError = $state("");
	private refreshCatalogue = false;
	private navigationPending = $state(false);
	private navigationGeneration = 0;
	private startupHandled = $state(false);
	private startupTarget = $state<string>();
	get isStarting() {
		return !this.startupHandled || !!this.startupTarget;
	}
	private handoff: string | null | undefined;

	// Native navigating also gates admission: SvelteKit skips beforeNavigate on supersession.
	beginNavigation(complete: Promise<void>, destination: string | undefined) {
		if (this.pending && this.handoff !== (destination ?? null)) return false;
		this.handoff = undefined;
		const generation = ++this.navigationGeneration;
		this.navigationPending = true;
		void complete.catch(async () => {
			await tick();
			if (generation === this.navigationGeneration && !this.routes.navigating())
				this.navigationPending = false;
		});
		return true;
	}
	private navigate = async (id: string | null, replace = false) => {
		this.handoff = id;
		try {
			await this.routes.navigate(id, replace);
		} finally {
			this.handoff = undefined;
		}
	};
	// This is called only by afterNavigate, never by a loader or a precommit hook.
	committedDestination = async (workspaceId: string | undefined, initial = false) => {
		if (workspaceId !== this.routes.destination()) return;
		this.navigationPending = false;
		if (workspaceId === this.startupTarget) this.startupTarget = undefined;
		if (!this.startupHandled) {
			this.startupHandled = true;
			if (initial && !workspaceId) {
				const active = this.catalogue?.active_workspace_id;
				if (active) {
					this.startupTarget = active;
					await this.navigate(active, true);
				}
				return;
			}
		}
		if (!workspaceId) return this.drainObservation(true);
		if (!this.current) {
			this.destinationError = "Workspace could not be loaded. Try opening it again.";
			await this.navigate(null, true);
			return;
		}
		// Creation already committed activation. Same-Workspace reads and Home preserve Undo.
		if (this.ready) return this.drainObservation(true);
		if (this.required?.workspaceId === workspaceId) {
			if (this.pending) return;
			return this.runAction(
				"restore",
				() => this.refresh(workspaceId, this.refreshCatalogue),
				{ workspaceId },
				true
			);
		}
		const outcome = await this.runAction(
			"open_workspace",
			async () => {
				if (workspaceId !== this.routes.destination())
					return { status: "rejected", message: "Destination changed." };
				const result = await this.desktop.switchWorkspace({ workspaceId });
				if (workspaceId !== this.routes.destination())
					return { status: "rejected", message: "Destination changed." };
				if (result.status === "rejected") {
					this.destinationError = result.message;
					await this.navigate(null, true);
					return result;
				}
				this.destinationError = "";
				this.requireSession(result.confirmed);
				const refreshed = await this.refresh(workspaceId, true);
				return refreshed.status === "applied"
					? refreshed
					: {
							status: "applied",
							notice: `Workspace opened, but it could not be refreshed. ${refreshed.message}`,
						};
			},
			{ workspaceId },
			true
		);
		if (outcome.status === "rejected" && this.routes.destination() === workspaceId) {
			this.destinationError = outcome.message;
			await this.navigate(null, true);
		}
		return outcome;
	};
	private requireSession(confirmed: ConfirmedSession) {
		this.required = {
			scope: confirmed.scope,
			revision: confirmed.revision,
			workspaceId:
				confirmed.session.status === "ready"
					? confirmed.session.catalogue.active_workspace_id
					: null,
			todoPath: confirmed.session.status === "ready" ? confirmed.session.todo_file.path : null,
		};
		this.refreshCatalogue = true;
	}
	private async sessionOutcome(outcome: Awaited<ReturnType<DesktopAPI["createWorkspace"]>>) {
		if (outcome.status !== "applied") return outcome;
		this.requireSession(outcome.confirmed);
		const refreshed = await this.refresh(
			this.routes.destination() === this.required!.workspaceId ? this.required!.workspaceId : null,
			true
		);
		return refreshed.status === "applied"
			? refreshed
			: {
					status: "applied" as const,
					notice: `Change saved, but the Workspace could not be refreshed. ${refreshed.message}`,
				};
	}
	private catalogueTarget() {
		if (!this.catalogue || this.routes.catalogue()?.error || this.refreshFailure)
			throw Error("Refresh Workspaces before changing them.");
	}
	create = (input: DesktopRequest<"createWorkspace">) =>
		this.runAction(
			"create_workspace",
			async () => {
				this.catalogueTarget();
				const outcome = await this.desktop.createWorkspace(input);
				if (outcome.status !== "applied") return outcome;
				this.requireSession(outcome.confirmed);
				this.destinationError = "";
				const id = this.required!.workspaceId;
				// Carry the committed receipt across navigation; its preloaded data cannot authorize writes.
				this.refreshFailure = "Workspace creation is saved; waiting for its route data.";
				try {
					await this.navigate(id);
				} catch (error) {
					this.refreshFailure = error instanceof Error ? error.message : String(error);
					return {
						status: "applied",
						notice: `Workspace created, but its destination could not be opened. ${this.refreshFailure}`,
					};
				}
				const refreshed = await this.refresh(id, true);
				return refreshed.status === "applied"
					? refreshed
					: {
							status: "applied",
							notice: `Workspace created, but it could not be refreshed. ${refreshed.message}`,
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
				this.requireSession(outcome.confirmed);
				if (this.routes.destination() && this.required!.workspaceId !== this.routes.destination()) {
					try {
						await this.navigate(null, true);
					} catch (error) {
						this.refreshFailure = error instanceof Error ? error.message : String(error);
						return {
							status: "applied",
							notice: `Workspace removed, but the screen could not be refreshed. ${this.refreshFailure}`,
						};
					}
				}
				return this.sessionOutcome(outcome);
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
		const unsubscribe = observation.onTodoFileChanged((event) => {
			const parsed = todoFileChangeEvent.payload.safeParse(event);
			const selection = this.selection ?? this.required;
			if (
				!listening ||
				!parsed.success ||
				!selection ||
				selection.scope !== parsed.data.scope ||
				selection.workspaceId !== parsed.data.workspaceId ||
				selection.todoPath !== parsed.data.todoPath ||
				parsed.data.revision < selection.revision
			)
				return;
			this.dirty = {
				event: parsed.data,
				notify: () => {
					if (listening) onSummaryChanged();
				},
			};
			this.drainObservation();
		});
		return () => {
			listening = false;
			this.dirty = undefined;
			unsubscribe();
		};
	};
	private drainObservation(committed = false) {
		if (
			this.pending ||
			this.navigationPending ||
			(!committed && this.routes.navigating()) ||
			!this.dirty
		)
			return;
		const { event, notify } = this.dirty;
		this.dirty = undefined;
		if (event.workspaceId !== this.routes.destination() || event.todoPath !== this.todoFile?.path)
			return;
		const before = JSON.stringify({ items: this.todoFile.items, skipped: this.todoFile.skipped });
		return this.runAction(
			"restore",
			async () => {
				this.required = {
					scope: event.scope,
					revision: event.revision,
					workspaceId: event.workspaceId,
					todoPath: event.todoPath,
				};
				const outcome = await this.refresh(event.workspaceId, true);
				// The authoritative session may now be Empty (an externally removed Todo file).
				if (
					this.routes.catalogue()?.value?.selection?.workspaceId === null &&
					this.current?.error
				) {
					this.destinationError = this.current.error;
					this.required = undefined;
					this.refreshFailure = "";
					await this.navigate(null, true);
				} else if (
					outcome.status === "applied" &&
					before !==
						JSON.stringify({ items: this.todoFile?.items, skipped: this.todoFile?.skipped })
				)
					notify();
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
				const current = new Map(this.todoFile?.items.map((item) => [item.line_number, item.raw]));
				if (items.some((item) => current.get(item.line_number) !== item.raw))
					return {
						status: "rejected",
						message: "The Todo file changed. Try again with its current Todo items.",
					};
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
				const current = new Map(this.todoFile?.items.map((item) => [item.line_number, item.raw]));
				if (items.some((item) => current.get(item.line_number) !== item.raw))
					return {
						status: "rejected",
						message: "The Todo file changed. Try again with its current Todo items.",
					};
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
				const current = new Map(this.todoFile?.items.map((item) => [item.line_number, item.raw]));
				if (items.some((item) => current.get(item.line_number) !== item.raw))
					return {
						status: "rejected",
						message: "The Todo file changed. Try again with its current Todo items.",
					};
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
