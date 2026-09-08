import {
	createWorkspace,
	deleteWorkspace,
	restoreWorkspaceSession,
	switchWorkspace,
} from "$lib/modules/workspace/api/workspace-api";
import type {
	Workspace,
	WorkspaceCatalogue,
	WorkspaceSessionOperationOutcome,
	WorkspaceSessionSnapshot,
} from "$lib/modules/workspace/domain/workspace";
import {
	deleteTodoItem,
	setTodoItemCompletion,
	type DeleteTodoItemInput,
	type SetTodoItemCompletionInput,
} from "$lib/modules/todo/api/todo-api";
import type { TodoFile, TodoItem } from "$lib/modules/todo/domain/todo";

export type CreateWorkspaceInput = { name: string; color: Workspace["color"]; todoPath: string };

export type WorkspaceSession =
	| { status: "loading" }
	| { status: "unavailable"; error: string }
	| { status: "empty"; catalogue: WorkspaceCatalogue; warning: string | null }
	| { status: "ready"; catalogue: WorkspaceCatalogue; todoFile: TodoFile };

export type WorkspaceSessionOperation =
	| "restore"
	| "create_workspace"
	| "open_workspace"
	| "delete_workspace"
	| "set_todo_item_completion"
	| "delete_todo_item";

export type WorkspaceSessionActionResult =
	| { status: "applied" }
	| { status: "conflict"; message: string }
	| { status: "rejected"; message: string };

export interface WorkspaceSessionAdapter {
	restore(): Promise<WorkspaceSessionSnapshot>;
	create(input: CreateWorkspaceInput): Promise<WorkspaceSessionOperationOutcome>;
	switchWorkspace(workspaceId: string): Promise<WorkspaceSessionOperationOutcome>;
	deleteWorkspace(workspaceId: string): Promise<WorkspaceSessionOperationOutcome>;
	setTodoItemCompletion(
		input: SetTodoItemCompletionInput
	): Promise<WorkspaceSessionOperationOutcome>;
	deleteTodoItem(input: DeleteTodoItemInput): Promise<WorkspaceSessionOperationOutcome>;
}

const tauriWorkspaceSessionAdapter: WorkspaceSessionAdapter = {
	restore: restoreWorkspaceSession,
	create: createWorkspace,
	switchWorkspace,
	deleteWorkspace,
	setTodoItemCompletion,
	deleteTodoItem,
};

type InMemoryOutcome<T, A = void> = T | Error | Promise<T> | ((argument: A) => T | Promise<T>);
type InMemoryOutcomes = Partial<{
	restore: InMemoryOutcome<WorkspaceSessionSnapshot>;
	create: InMemoryOutcome<WorkspaceSessionOperationOutcome, CreateWorkspaceInput>;
	switchWorkspace: InMemoryOutcome<WorkspaceSessionOperationOutcome, string>;
	deleteWorkspace: InMemoryOutcome<WorkspaceSessionOperationOutcome, string>;
	setTodoItemCompletion: InMemoryOutcome<
		WorkspaceSessionOperationOutcome,
		SetTodoItemCompletionInput
	>;
	deleteTodoItem: InMemoryOutcome<WorkspaceSessionOperationOutcome, DeleteTodoItemInput>;
}>;

export class InMemoryWorkspaceSessionAdapter implements WorkspaceSessionAdapter {
	constructor(private readonly outcomes: InMemoryOutcomes) {}

	restore = () => resolveOutcome(this.outcomes.restore);
	create = (input: CreateWorkspaceInput) => resolveOutcome(this.outcomes.create, input);
	switchWorkspace = (workspaceId: string) =>
		resolveOutcome(this.outcomes.switchWorkspace, workspaceId);
	deleteWorkspace = (workspaceId: string) =>
		resolveOutcome(this.outcomes.deleteWorkspace, workspaceId);
	setTodoItemCompletion = (input: SetTodoItemCompletionInput) =>
		resolveOutcome(this.outcomes.setTodoItemCompletion, input);
	deleteTodoItem = (input: DeleteTodoItemInput) =>
		resolveOutcome(this.outcomes.deleteTodoItem, input);
}

export class WorkspaceSessionState {
	private currentSession = $state.raw<WorkspaceSession>(deepFreeze({ status: "loading" }));
	private currentOperation = $state.raw<WorkspaceSessionOperation | null>(null);

	constructor(private readonly adapter: WorkspaceSessionAdapter = tauriWorkspaceSessionAdapter) {}

	get session(): Readonly<WorkspaceSession> {
		return this.currentSession;
	}

	get pendingOperation(): WorkspaceSessionOperation | null {
		return this.currentOperation;
	}

	get isOperating(): boolean {
		return this.currentOperation !== null;
	}

	get catalogue(): WorkspaceCatalogue | null {
		return this.currentSession.status === "empty" || this.currentSession.status === "ready"
			? this.currentSession.catalogue
			: null;
	}

	get activeWorkspace(): Workspace | null {
		const catalogue = this.catalogue;
		return catalogue?.workspaces.find(({ id }) => id === catalogue.active_workspace_id) ?? null;
	}

	get todoFile(): TodoFile | null {
		return this.currentSession.status === "ready" ? this.currentSession.todoFile : null;
	}

	get error(): string {
		return this.currentSession.status === "unavailable" ? this.currentSession.error : "";
	}

	get warning(): string {
		return this.currentSession.status === "empty" ? (this.currentSession.warning ?? "") : "";
	}

	get isLoading(): boolean {
		return this.currentSession.status === "loading";
	}

	restore = async (): Promise<void> => {
		await this.runOperation("restore", async () => {
			try {
				this.applySnapshot(await this.adapter.restore());
			} catch (error) {
				this.currentSession = deepFreeze({
					status: "unavailable",
					error: formatUnknownError(error),
				});
			}
		});
	};

	create = (input: CreateWorkspaceInput): Promise<WorkspaceSessionActionResult> =>
		this.runAction("create_workspace", () => this.adapter.create(input));

	open = (workspaceId: string): Promise<WorkspaceSessionActionResult> =>
		this.runAction("open_workspace", () => this.adapter.switchWorkspace(workspaceId));

	deleteWorkspace = (workspaceId: string): Promise<WorkspaceSessionActionResult> =>
		this.runAction("delete_workspace", () => this.adapter.deleteWorkspace(workspaceId));

	setCompletion = (todo: TodoItem): Promise<WorkspaceSessionActionResult> =>
		this.runAction("set_todo_item_completion", () =>
			this.adapter.setTodoItemCompletion({
				lineNumber: todo.line_number,
				expectedRaw: todo.raw,
				completed: !todo.completed,
			})
		);

	deleteTodo = (todo: TodoItem): Promise<WorkspaceSessionActionResult> =>
		this.runAction("delete_todo_item", () =>
			this.adapter.deleteTodoItem({
				lineNumber: todo.line_number,
				expectedRaw: todo.raw,
			})
		);

	private runAction(
		operation: WorkspaceSessionOperation,
		invoke: () => Promise<WorkspaceSessionOperationOutcome>
	): Promise<WorkspaceSessionActionResult> {
		return this.runOperation(operation, async () => {
			const outcome = await invoke();
			if (outcome.outcome === "rejected") {
				return { status: "rejected", message: outcome.message };
			}
			this.applySnapshot(outcome.snapshot);
			return outcome.outcome === "conflict"
				? { status: "conflict", message: outcome.message }
				: { status: "applied" };
		});
	}

	private async runOperation<T>(
		operation: WorkspaceSessionOperation,
		run: () => Promise<T>
	): Promise<T> {
		if (this.currentOperation !== null) {
			throw new Error(
				"Cannot start " + operation + " while " + this.currentOperation + " is already running"
			);
		}
		this.currentOperation = operation;
		try {
			return await run();
		} finally {
			this.currentOperation = null;
		}
	}

	private applySnapshot(snapshot: WorkspaceSessionSnapshot): void {
		if (snapshot.status === "active_workspace_loaded") {
			this.currentSession = deepFreeze({
				status: "ready",
				catalogue: snapshot.catalogue,
				todoFile: snapshot.todo_file,
			});
			return;
		}
		this.currentSession = deepFreeze({
			status: "empty",
			catalogue: snapshot.catalogue,
			warning: snapshot.status === "active_workspace_unavailable" ? snapshot.warning : null,
		});
	}
}

function deepFreeze<T>(value: T): T {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}

async function resolveOutcome<T, A>(
	outcome: InMemoryOutcome<T, A> | undefined,
	argument?: A
): Promise<T> {
	if (outcome instanceof Error) throw outcome;
	if (typeof outcome === "function") {
		return (outcome as (argument: A) => T | Promise<T>)(argument as A);
	}
	if (outcome === undefined)
		throw new Error("No in-memory Workspace session outcome was configured");
	return outcome;
}

function formatUnknownError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return String(error);
}
