import {
	MutationObserver,
	type MutationObserverResult,
	type QueryClient,
} from "@tanstack/svelte-query";
import type { WorkspaceData } from "./workspace-data.svelte";
import { workspaceQueryKeys } from "./workspace-queries";
import {
	type TodoSortOrder,
	type SavedViewFilterValues,
	type DesktopAPI,
	type DesktopRequest,
	type DesktopResponse,
	type TodoFileObservation,
	type TodoFileChange,
	todoFileChangeEvent,
} from "$lib/shared/desktop/contract";
import type {
	WorkspaceSessionActionResult,
	WorkspaceSessionOperation,
} from "./workspace-session-types";
import type { TodoItem } from "$lib/modules/todo/domain/todo";

type CreateTodoRequest = DesktopRequest<"createTodo">;
export type CreateTodoDraft = Omit<CreateTodoRequest, "scope" | "revision" | "workspaceId">;

type CommandInput = {
	operation: WorkspaceSessionOperation;
	action: () => Promise<WorkspaceSessionActionResult>;
};

export class WorkspaceCommands {
	private mutationResult =
		$state.raw<MutationObserverResult<WorkspaceSessionActionResult, Error, CommandInput>>();
	private readonly mutation: MutationObserver<WorkspaceSessionActionResult, Error, CommandInput>;
	private readonly unsubscribe: () => void;
	private refreshFailed = $state(false);
	private reconsiderObservation: (() => void) | undefined;

	constructor(
		private readonly desktop: DesktopAPI,
		readonly data: WorkspaceData,
		private readonly queryClient: QueryClient,
		private readonly navigationPending: () => boolean = () => false,
		private readonly afterRefresh: (
			dependency: "session" | "views" | "lifecycle"
		) => Promise<void> = async () => {}
	) {
		this.mutation = new MutationObserver(queryClient, {
			mutationKey: [...workspaceQueryKeys.all, "command"],
			mutationFn: ({ action }) => action(),
			retry: false,
			networkMode: "always",
		});
		this.mutationResult = this.mutation.getCurrentResult();
		this.unsubscribe = this.mutation.subscribe((result) => {
			this.mutationResult = result;
		});
	}

	destroy() {
		this.unsubscribe();
	}
	private async invalidate(dependency: "session" | "views" | "lifecycle") {
		if (dependency === "lifecycle" || this.pendingOperation === "restore")
			await this.queryClient.invalidateQueries({
				queryKey: workspaceQueryKeys.destinations,
				refetchType: "none",
			});
		try {
			const results = await Promise.allSettled([
				...((dependency === "session" || this.pendingOperation === "delete_workspace") &&
				this.data.routeWorkspaceId
					? [
							this.queryClient.invalidateQueries(
								{
									queryKey: workspaceQueryKeys.destination(this.data.routeWorkspaceId),
									exact: true,
									refetchType: "all",
								},
								{ throwOnError: true }
							),
						]
					: []),
				...(dependency !== "views"
					? [
							this.queryClient.invalidateQueries(
								{ queryKey: workspaceQueryKeys.session },
								{ throwOnError: true }
							),
						]
					: []),
				...(dependency !== "session"
					? [
							this.queryClient.invalidateQueries(
								{ queryKey: workspaceQueryKeys.views },
								{ throwOnError: true }
							),
						]
					: []),
			]);
			const failure = results.find((result) => result.status === "rejected");
			if (failure?.status === "rejected") throw failure.reason;
		} finally {
			await this.afterRefresh(dependency);
		}
	}

	get refreshError() {
		return this.refreshFailed
			? "The screen could not refresh. Retry loading before making another change."
			: "";
	}

	resumeObservation = () => this.reconsiderObservation?.();

	observe = (observation: TodoFileObservation, onSummaryChanged: () => void) => {
		let listening = true;
		let deferred: TodoFileChange | undefined;
		const reconsider = () => {
			if (!listening || this.isOperating || !deferred) return;
			const event = deferred;
			deferred = undefined;
			const previous = this.data.confirmed;
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
				const file = this.data.todoFile;
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
		dependency: "session" | "views" | "lifecycle" = "session",
		refresh?: () => Promise<void>
	): Promise<T & { notice?: string }> {
		if (outcome.status !== "rejected") {
			try {
				await this.invalidate(dependency);
				if (refresh) await refresh();
				const error = dependency !== "views" ? this.data.error : this.data.savedViewsError;
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

	private todoTarget(): Pick<CreateTodoRequest, "scope" | "revision" | "workspaceId"> {
		const confirmed = this.data.confirmed;
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

	undoTodo = () =>
		this.runAction("undo_todo_change", async () =>
			this.refreshOutcome(await this.desktop.undoTodo(this.todoTarget()))
		);
	setSortOrder = (sortOrder: TodoSortOrder) =>
		this.runAction("set_workspace_sort_order", async () =>
			this.refreshOutcome(
				await this.desktop.setWorkspaceSortOrder({ ...this.todoTarget(), sortOrder })
			)
		);
	setShowDeferred = (showDeferred: boolean) =>
		this.runAction("set_workspace_show_deferred", async () =>
			this.refreshOutcome(
				await this.desktop.setWorkspaceShowDeferred({ ...this.todoTarget(), showDeferred })
			)
		);
	get pendingOperation(): WorkspaceSessionOperation | null {
		return this.mutationResult?.isPending ? this.mutationResult.variables.operation : null;
	}
	get isOperating() {
		return (
			!!this.mutationResult?.isPending ||
			this.mutation.getCurrentResult().isPending ||
			this.navigationPending()
		);
	}
	private async runAction(
		operation: WorkspaceSessionOperation,
		action: () => Promise<WorkspaceSessionActionResult>
	): Promise<WorkspaceSessionActionResult> {
		if (this.isOperating)
			return { status: "rejected", message: "A Workspace session operation is already running." };
		// Admission and pending UI share one synchronous state transition.
		try {
			const outcome = await this.mutation.mutate({ operation, action });
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
			this.reconsiderObservation?.();
		}
	}
	restore = () =>
		this.runAction("restore", async () => {
			try {
				await this.desktop.restoreSession({});
				await this.invalidate("session");
				const error = this.data.error;
				this.refreshFailed = !!error;
				return error ? { status: "rejected", message: error } : { status: "applied" };
			} catch (error) {
				this.refreshFailed = true;
				throw error;
			}
		});

	reloadViews = () =>
		this.runAction("reload_views", async () => {
			await this.invalidate("views");
			return this.data.savedViewsError
				? { status: "rejected", message: this.data.savedViewsError }
				: { status: "applied" };
		});

	saveView = (name: string, filters: SavedViewFilterValues) =>
		this.runAction("save_view", async () => {
			const workspaceId = this.data.activeWorkspace?.id;
			if (!workspaceId) return { status: "rejected", message: "Open a Workspace first." };
			const outcome = await this.desktop.saveView({ workspaceId, name, filters });
			return this.refreshOutcome(outcome, "views");
		});
	deleteView = (viewId: string) =>
		this.runAction("delete_view", async () => {
			const workspaceId = this.data.activeWorkspace?.id;
			if (!workspaceId) return { status: "rejected", message: "Open a Workspace first." };
			const outcome = await this.desktop.deleteView({ workspaceId, viewId });
			return this.refreshOutcome(outcome, "views");
		});

	create = (
		input: DesktopRequest<"createWorkspace">,
		navigate?: (workspaceId: string) => Promise<void>
	) =>
		this.runAction("create_workspace", async () => {
			const saved = await this.desktop.createWorkspace(input);
			const workspaceId =
				saved.status === "applied" && saved.confirmed.session.status === "ready"
					? saved.confirmed.session.catalogue.active_workspace_id
					: null;
			const outcome = await this.refreshOutcome(
				saved,
				"lifecycle",
				navigate && workspaceId ? () => navigate(workspaceId) : undefined
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
		});
	open = (
		workspaceId: string,
		navigate?: (outcome: WorkspaceSessionActionResult) => Promise<void>,
		beforeActivation?: Promise<void>
	) =>
		this.runAction("open_workspace", async () => {
			if (beforeActivation) await beforeActivation;
			let outcome: DesktopResponse<"switchWorkspace">;
			try {
				outcome = await this.desktop.switchWorkspace({ workspaceId });
			} catch (error) {
				outcome = {
					status: "rejected",
					message: error instanceof Error ? error.message : String(error),
				};
			}
			if (navigate && outcome.status === "rejected") {
				await navigate(outcome);
				return outcome;
			}
			return this.refreshOutcome(
				outcome,
				"lifecycle",
				navigate ? () => navigate(outcome) : undefined
			);
		});
	deleteWorkspace = (workspaceId: string) =>
		this.runAction("delete_workspace", async () =>
			this.refreshOutcome(await this.desktop.deleteWorkspace({ workspaceId }), "lifecycle")
		);
	setCompletion = (todo: TodoItem) =>
		this.runAction("set_todo_item_completion", async () => {
			const input = this.todoMutationTarget(todo);
			return this.refreshOutcome(
				await this.desktop.setTodoCompletion({ ...input, completed: !todo.completed })
			);
		});
	bulkSetCompletion = (items: readonly TodoItem[], completed: boolean) =>
		this.runAction("bulk_set_todo_item_completion", async () => {
			const target = this.todoBatchTarget(items);
			return this.refreshOutcome(
				await this.desktop.bulkSetTodoCompletion({
					...target,
					completed,
					targets: items.map((item) => ({
						lineNumber: item.line_number,
						expectedRaw: item.raw,
					})),
				})
			);
		});
	bulkDeleteTodos = (items: readonly TodoItem[]) =>
		this.runAction("bulk_delete_todo_items", async () => {
			const target = this.todoBatchTarget(items);
			return this.refreshOutcome(
				await this.desktop.bulkDeleteTodos({
					...target,
					targets: items.map((item) => ({
						lineNumber: item.line_number,
						expectedRaw: item.raw,
					})),
				})
			);
		});
	private todoBatchTarget(items: readonly TodoItem[]) {
		const target = this.todoTarget();
		const current = new Map(this.data.todoFile?.items.map((item) => [item.line_number, item.raw]));
		if (items.some((item) => current.get(item.line_number) !== item.raw))
			throw Error("The Todo file changed. Try again with its current Todo items.");
		return target;
	}
	private todoMutationTarget(todo: TodoItem): DesktopRequest<"deleteTodo"> {
		return { ...this.todoTarget(), lineNumber: todo.line_number, expectedRaw: todo.raw };
	}
	editTodo = (todo: TodoItem, draft: CreateTodoDraft) =>
		this.runAction("edit_todo_item", async () => {
			const target = this.todoMutationTarget(todo);
			return this.refreshOutcome(
				await this.desktop.editTodo({
					...draft,
					...target,
					creationDate: draft.creationDate ?? null,
					completed: draft.completed ?? todo.completed,
				})
			);
		});
	deleteTodo = (todo: TodoItem) =>
		this.runAction("delete_todo_item", async () => {
			const input = this.todoMutationTarget(todo);
			return this.refreshOutcome(await this.desktop.deleteTodo(input));
		});
	reorderTodo = (items: readonly TodoItem[]) =>
		this.runAction("reorder_todo_items", async () => {
			const target = this.todoBatchTarget(items);
			return this.refreshOutcome(
				await this.desktop.reorderTodo({
					...target,
					lineNumbers: items.map((item) => item.line_number),
				})
			);
		});
	createTodo = (draft: CreateTodoDraft) =>
		this.runAction("create_todo_item", async () => {
			const target = this.todoTarget();
			return this.refreshOutcome(await this.desktop.createTodo({ ...target, ...draft }));
		});
}
