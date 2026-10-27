import type {
	Catalogue,
	ConfirmedSession,
	DesktopAPI,
	DesktopRequest,
	TodoFile,
} from "@tuxedo/contracts";
import type { TodoItem } from "#lib/modules/todo/domain/todo.js";
import type { SessionData, WorkspaceData } from "./workspace-route-data";
import type { DisplayedDataTarget, InvalidateDisplayedData } from "./invalidate-displayed-data";
import type {
	WorkspaceSessionActionResult,
	WorkspaceSessionOperationTarget,
} from "./workspace-session-types";
import { CommandValidationError, WorkspaceCommandGate } from "./workspace-command-gate.svelte";
import { todoCommands } from "./todo-commands";
import { workspaceLifecycleCommands } from "./workspace-lifecycle-commands";

export type WorkspaceRoutes = {
	session: () => SessionData | undefined;
	workspace: () => WorkspaceData | undefined;
	destination: () => string | undefined;
	navigating: () => boolean;
	invalidate: InvalidateDisplayedData;
};
export type CreateTodoDraft = Omit<
	DesktopRequest<"createTodo">,
	"scope" | "revision" | "workspaceId"
>;

/** Loader-derived reads and recovery shared by the command modules. */
export interface WorkspaceReader {
	readonly current: WorkspaceData | undefined;
	readonly confirmed: ConfirmedSession | undefined;
	readonly catalogue: Catalogue | null;
	readonly activeWorkspace: Catalogue["workspaces"][number] | undefined;
	readonly todoFile: TodoFile | null;
	readonly ready: boolean;
	readonly recoveryError: string;
	refresh(target: DisplayedDataTarget): Promise<WorkspaceSessionActionResult>;
	requireRevision(value: { scope: string; revision: number }): void;
	todoTarget(): { scope: string; revision: number; workspaceId: string };
	todoOperationTarget(todo?: TodoItem): WorkspaceSessionOperationTarget | null;
}
export type WorkspaceCommandContext = {
	readonly desktop: DesktopAPI;
	readonly gate: WorkspaceCommandGate;
	readonly routes: WorkspaceRoutes;
	readonly reader: WorkspaceReader;
};

// Displayed data comes from loaders. Commands retain only admission and recovery metadata.
export class WorkspaceCommands implements WorkspaceReader {
	readonly gate: WorkspaceCommandGate;
	private minimumRevision = $state(-1);

	readonly retry;
	readonly activate;
	readonly create;
	readonly deleteWorkspace;
	readonly setSortOrder;
	readonly setShowDeferred;
	readonly undoTodo;
	readonly setCompletion;
	readonly bulkSetCompletion;
	readonly bulkDeleteTodos;
	readonly editTodo;
	readonly deleteTodo;
	readonly reorderTodo;
	readonly createTodo;

	constructor(
		desktop: DesktopAPI,
		private readonly routes: WorkspaceRoutes
	) {
		this.gate = new WorkspaceCommandGate(routes.navigating);
		const context: WorkspaceCommandContext = { desktop, gate: this.gate, routes, reader: this };
		const lifecycle = workspaceLifecycleCommands(context);
		this.retry = lifecycle.retry;
		this.activate = lifecycle.activate;
		this.create = lifecycle.create;
		this.deleteWorkspace = lifecycle.deleteWorkspace;
		this.setSortOrder = lifecycle.setSortOrder;
		this.setShowDeferred = lifecycle.setShowDeferred;
		const todo = todoCommands(context);
		this.undoTodo = todo.undoTodo;
		this.setCompletion = todo.setCompletion;
		this.bulkSetCompletion = todo.bulkSetCompletion;
		this.bulkDeleteTodos = todo.bulkDeleteTodos;
		this.editTodo = todo.editTodo;
		this.deleteTodo = todo.deleteTodo;
		this.reorderTodo = todo.reorderTodo;
		this.createTodo = todo.createTodo;
	}
	get current() {
		const data = this.routes.workspace();
		return data?.workspaceId === this.routes.destination() ? data : undefined;
	}
	get confirmed() {
		return this.routes.session()?.value ?? undefined;
	}
	get catalogue() {
		return this.confirmed?.session.status !== "unavailable"
			? (this.confirmed?.session.catalogue ?? null)
			: null;
	}
	get activeWorkspace() {
		return this.catalogue?.workspaces.find(
			(workspace) => workspace.id === this.catalogue?.active_workspace_id
		);
	}
	get todoFile() {
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
		return this.gate.isOperating;
	}
	get canMutate() {
		return this.ready && !this.isOperating;
	}
	get pendingOperation() {
		return this.gate.pendingOperation;
	}
	get pendingTarget() {
		return this.gate.pendingTarget;
	}
	private get error() {
		return this.routes.session()?.error ?? "";
	}
	get recoveryError() {
		return this.gate.failure || this.current?.error || this.error;
	}
	get writesBlocked() {
		return !this.canMutate;
	}
	whenIdle() {
		return this.gate.whenIdle();
	}
	requireRevision(value: { scope: string; revision: number }) {
		if (this.confirmed && value.scope !== this.confirmed.scope)
			throw Error("The Workspace session changed. Refresh its current contents.");
		this.minimumRevision = Math.max(this.minimumRevision, value.revision);
	}
	async refresh({
		workspaceId = null,
		session = false,
	}: DisplayedDataTarget): Promise<WorkspaceSessionActionResult> {
		try {
			await this.routes.invalidate({ session, workspaceId });
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
			this.gate.failure = "";
			return { status: "applied" };
		} catch (error) {
			this.gate.failure = error instanceof Error ? error.message : String(error);
			return { status: "rejected", message: this.gate.failure };
		}
	}
	todoTarget() {
		const confirmation = this.current?.value?.confirmation;
		if (!this.ready || !confirmation || !this.activeWorkspace)
			throw new CommandValidationError("Refresh the Workspace before changing Todo items.");
		return {
			scope: confirmation.scope,
			revision: confirmation.revision,
			workspaceId: this.activeWorkspace.id,
		};
	}
	todoOperationTarget(todo?: TodoItem): WorkspaceSessionOperationTarget | null {
		const workspaceId = this.catalogue?.active_workspace_id;
		return workspaceId ? { workspaceId, ...(todo ? { lineNumber: todo.line_number } : {}) } : null;
	}
}
