import {
	createWorkspace,
	deleteWorkspace,
	restoreWorkspaceSession,
	switchWorkspace,
} from "$lib/modules/workspace/api/workspace-api";
import {
	parseWorkspaceSessionSnapshotResponse,
	type Workspace,
	type WorkspaceCatalogue,
	type WorkspaceSessionSnapshot,
} from "$lib/modules/workspace/domain/workspace";
import type { TodoFile } from "$lib/modules/todo/domain/todo";

export type CreateWorkspaceInput = { name: string; color: Workspace["color"]; todoPath: string };

export type WorkspaceSession =
	| { status: "loading" }
	| { status: "unavailable"; error: string }
	| { status: "empty"; catalogue: WorkspaceCatalogue; warning: string | null }
	| { status: "ready"; catalogue: WorkspaceCatalogue; todoFile: TodoFile };

export type WorkspaceNotice = { kind: "error"; message: string };

export interface WorkspaceLifecycleAdapter {
	restore(): Promise<unknown>;
	create(input: CreateWorkspaceInput): Promise<unknown>;
	switchWorkspace(workspaceId: string): Promise<unknown>;
	deleteWorkspace(workspaceId: string): Promise<unknown>;
}

const tauriWorkspaceLifecycleAdapter: WorkspaceLifecycleAdapter = {
	restore: restoreWorkspaceSession,
	create: createWorkspace,
	switchWorkspace,
	deleteWorkspace,
};

type InMemoryOutcome<T, A = void> = T | Error | Promise<T> | ((argument: A) => T | Promise<T>);
type InMemoryOutcomes = Partial<{
	restore: InMemoryOutcome<unknown>;
	create: InMemoryOutcome<unknown, CreateWorkspaceInput>;
	switchWorkspace: InMemoryOutcome<unknown, string>;
	deleteWorkspace: InMemoryOutcome<unknown, { workspaceId: string }>;
}>;

/** An adapter used by tests to drive lifecycle results without mutating session internals. */
export class InMemoryWorkspaceLifecycleAdapter implements WorkspaceLifecycleAdapter {
	constructor(private readonly outcomes: InMemoryOutcomes) {}

	restore = () => resolveOutcome(this.outcomes.restore);
	create = (input: CreateWorkspaceInput) => resolveOutcome(this.outcomes.create, input);
	switchWorkspace = (workspaceId: string) =>
		resolveOutcome(this.outcomes.switchWorkspace, workspaceId);
	deleteWorkspace = (workspaceId: string) =>
		resolveOutcome(this.outcomes.deleteWorkspace, { workspaceId });
}

export class WorkspaceState {
	session = $state.raw<WorkspaceSession>({ status: "loading" });
	notice = $state.raw<WorkspaceNotice | null>(null);
	isOperating = $state(false);

	constructor(
		private readonly adapter: WorkspaceLifecycleAdapter = tauriWorkspaceLifecycleAdapter
	) {}

	get catalogue(): WorkspaceCatalogue | null {
		return this.session.status === "empty" || this.session.status === "ready"
			? this.session.catalogue
			: null;
	}

	get activeWorkspace(): Workspace | null {
		const catalogue = this.catalogue;
		return catalogue?.workspaces.find(({ id }) => id === catalogue.active_workspace_id) ?? null;
	}

	get todoFile(): TodoFile | null {
		return this.session.status === "ready" ? this.session.todoFile : null;
	}

	get error(): string {
		return this.session.status === "unavailable"
			? this.session.error
			: (this.notice?.message ?? "");
	}

	get warning(): string {
		return this.session.status === "empty" ? (this.session.warning ?? "") : "";
	}

	get isLoading(): boolean {
		return this.session.status === "loading";
	}

	restore = async () => {
		if (!this.beginOperation())
			throw new Error("A Workspace lifecycle operation is already running");
		try {
			this.applySnapshot(parseWorkspaceSessionSnapshotResponse(await this.adapter.restore()));
		} catch (error) {
			this.session = { status: "unavailable", error: formatUnknownError(error) };
		} finally {
			this.isOperating = false;
		}
	};

	create = async (input: CreateWorkspaceInput) => {
		if (!this.beginOperation())
			throw new Error("A Workspace lifecycle operation is already running");
		try {
			this.applySnapshot(parseWorkspaceSessionSnapshotResponse(await this.adapter.create(input)));
		} catch (error) {
			this.attachOperationError(error);
			throw error;
		} finally {
			this.isOperating = false;
		}
	};

	open = async (workspaceId: string) => {
		if (!this.beginOperation())
			throw new Error("A Workspace lifecycle operation is already running");
		try {
			this.applySnapshot(
				parseWorkspaceSessionSnapshotResponse(await this.adapter.switchWorkspace(workspaceId))
			);
		} catch (error) {
			this.attachOperationError(error, "Could not open workspace");
		} finally {
			this.isOperating = false;
		}
	};

	delete = async (workspaceId: string) => {
		if (!this.beginOperation())
			throw new Error("A Workspace lifecycle operation is already running");
		try {
			this.applySnapshot(
				parseWorkspaceSessionSnapshotResponse(await this.adapter.deleteWorkspace(workspaceId))
			);
		} catch (error) {
			this.attachOperationError(error, "Could not delete workspace");
		} finally {
			this.isOperating = false;
		}
	};

	private beginOperation(): boolean {
		if (this.isOperating) return false;
		this.isOperating = true;
		this.notice = null;
		return true;
	}

	private applySnapshot(snapshot: WorkspaceSessionSnapshot) {
		if (snapshot.status === "active_workspace_loaded") {
			this.session = {
				status: "ready",
				catalogue: snapshot.catalogue,
				todoFile: snapshot.todo_file,
			};
			return;
		}
		this.session = {
			status: "empty",
			catalogue: snapshot.catalogue,
			warning: snapshot.status === "active_workspace_unavailable" ? snapshot.warning : null,
		};
	}

	replaceTodoFile = (todoFile: TodoFile) => {
		if (this.session.status !== "ready") return;
		this.session = { ...this.session, todoFile };
	};

	refreshTodoFile = async () => {
		this.applySnapshot(parseWorkspaceSessionSnapshotResponse(await this.adapter.restore()));
	};

	private attachOperationError(error: unknown, prefix?: string) {
		const message = formatUnknownError(error);
		this.notice = { kind: "error", message: prefix ? `${prefix}: ${message}` : message };
	}
}

async function resolveOutcome<T, A>(
	outcome: InMemoryOutcome<T, A> | undefined,
	argument?: A
): Promise<T> {
	if (outcome instanceof Error) throw outcome;
	if (typeof outcome === "function")
		return (outcome as (argument: A) => T | Promise<T>)(argument as A);
	if (outcome === undefined) throw new Error("No in-memory lifecycle outcome was configured");
	return outcome;
}

function formatUnknownError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (hasMessage(error)) return error.message;
	return String(error);
}

function hasMessage(value: unknown): value is { message: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"message" in value &&
		typeof value.message === "string"
	);
}
