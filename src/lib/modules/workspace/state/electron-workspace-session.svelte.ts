import {
	confirmedSessionSchema,
	confirmedTodoSchema,
	type ConfirmedTodo,
	type ConfirmedSession,
	type DesktopAPI,
	type DesktopRequest,
} from "$lib/shared/desktop/contract";
import type {
	WorkspaceSessionActionResult,
	PendingWorkspaceSessionOperation,
	WorkspaceSessionOperation,
	WorkspaceSessionOperationTarget,
} from "./workspace-session-types";
import type { TodoItem } from "$lib/modules/todo/domain/todo";
export function reconcileConfirmedSession(
	previous: ConfirmedSession | undefined,
	incoming: ConfirmedSession
): ConfirmedSession {
	const parsed = confirmedSessionSchema.parse(incoming);
	if (previous && (previous.scope !== parsed.scope || previous.revision > parsed.revision))
		return previous;
	return parsed;
}
export function reconcileConfirmedTodo(
	previous: ConfirmedSession | undefined,
	incoming: ConfirmedTodo
): ConfirmedSession | undefined {
	const parsed = confirmedTodoSchema.parse(incoming);
	if (
		!previous ||
		previous.scope !== parsed.scope ||
		previous.revision > parsed.revision ||
		previous.session.status !== "ready" ||
		previous.session.catalogue.active_workspace_id !== parsed.workspaceId ||
		previous.session.todo_file.path !== parsed.todo_file.path
	)
		return previous;
	return {
		...previous,
		revision: parsed.revision,
		session: { ...previous.session, todo_file: parsed.todo_file },
	};
}
export class ElectronWorkspaceSessionState {
	private confirmed = $state.raw<ConfirmedSession>();
	private readError = $state<string | null>(null);
	private pending = $state<PendingWorkspaceSessionOperation | null>(null);

	constructor(private readonly desktop: DesktopAPI) {
		void this.readInitialSession();
	}

	private async readInitialSession() {
		try {
			this.acceptSession(await this.desktop.readSession({}));
		} catch (error) {
			// Restoration may already have supplied a newer confirmed session.
			if (!this.confirmed) this.readError = error instanceof Error ? error.message : String(error);
		}
	}

	private acceptSession(incoming: ConfirmedSession) {
		this.confirmed = reconcileConfirmedSession(this.confirmed, incoming);
		this.readError = null;
	}

	private applySessionOutcome(outcome: Awaited<ReturnType<DesktopAPI["createWorkspace"]>>) {
		if (outcome.status === "applied") this.acceptSession(outcome.confirmed);
		return outcome;
	}

	private applyTodoOutcome(outcome: Awaited<ReturnType<DesktopAPI["deleteTodo"]>>) {
		if (outcome.status !== "rejected")
			this.confirmed = reconcileConfirmedTodo(this.confirmed, outcome.confirmed);
		return outcome;
	}

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
				? { status: "applied" }
				: { status: outcome.status, message: outcome.message };
		} catch (error) {
			return {
				status: "rejected",
				message: error instanceof Error ? error.message : String(error),
			};
		} finally {
			this.pending = null;
		}
	}
	restore = () =>
		this.runAction("restore", async () => {
			this.acceptSession(await this.desktop.restoreSession({}));
			return { status: "applied" };
		});
	create = (input: DesktopRequest<"createWorkspace">) =>
		this.runAction(
			"create_workspace",
			async () => this.applySessionOutcome(await this.desktop.createWorkspace(input)),
			{ todoPath: input.todoPath }
		);
	open = (workspaceId: string) =>
		this.runAction(
			"open_workspace",
			async () => this.applySessionOutcome(await this.desktop.switchWorkspace({ workspaceId })),
			{ workspaceId }
		);
	deleteWorkspace = (workspaceId: string) =>
		this.runAction(
			"delete_workspace",
			async () => this.applySessionOutcome(await this.desktop.deleteWorkspace({ workspaceId })),
			{ workspaceId }
		);
	setCompletion = (todo: TodoItem) =>
		this.runAction(
			"set_todo_item_completion",
			async () => {
				const input = this.todoMutationTarget(todo);
				if (!input)
					return { status: "rejected", message: "No Active workspace Todo file is loaded." };
				return this.applyTodoOutcome(
					await this.desktop.setTodoCompletion({ ...input, completed: !todo.completed })
				);
			},
			this.todoOperationTarget(todo)
		);
	private todoMutationTarget(todo: TodoItem): DesktopRequest<"deleteTodo"> | null {
		const confirmed = this.confirmed;
		if (
			!confirmed ||
			confirmed.session.status !== "ready" ||
			!confirmed.session.catalogue.active_workspace_id
		)
			return null;
		return {
			scope: confirmed.scope,
			revision: confirmed.revision,
			workspaceId: confirmed.session.catalogue.active_workspace_id,
			lineNumber: todo.line_number,
			expectedRaw: todo.raw,
		};
	}
	private todoOperationTarget(todo: TodoItem): WorkspaceSessionOperationTarget | null {
		const workspaceId = this.catalogue?.active_workspace_id;
		return workspaceId ? { workspaceId, lineNumber: todo.line_number } : null;
	}
	deleteTodo = (todo: TodoItem) =>
		this.runAction(
			"delete_todo_item",
			async () => {
				const input = this.todoMutationTarget(todo);
				if (!input)
					return { status: "rejected", message: "No Active workspace Todo file is loaded." };
				return this.applyTodoOutcome(await this.desktop.deleteTodo(input));
			},
			this.todoOperationTarget(todo)
		);
}
