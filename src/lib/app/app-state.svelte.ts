import {
	summarizeTodoFile,
	type TodoFileSummary,
} from "$lib/modules/todo/domain/todo-file-summary";
import { type TodoFileObservationAdapter } from "$lib/modules/todo/state/todo-file-observation";
import { TodoState, type TodoMutationAdapter } from "$lib/modules/todo/state/todo-state.svelte";
import {
	WorkspaceState,
	type CreateWorkspaceInput,
} from "$lib/modules/workspace/state/workspace-state.svelte";

/** Matches Rust observation coalesce so atomic replace flickers can recover before Empty sticks. */
export const UNREADABLE_TODO_FILE_DEBOUNCE_MS = 250;

export type ObservationNotices = {
	onObservationSummaryChanged?: () => void;
};

export class AppState {
	workspace: WorkspaceState;
	todo: TodoState;
	todos: TodoFileSummary;
	isWorkspaceCreationDialogOpen = $state(false);

	private readonly observation: TodoFileObservationAdapter | null;
	private readonly notices: ObservationNotices;
	private observedPath: string | null = null;
	private isObservationRefreshPending = false;

	constructor(
		workspace = new WorkspaceState(),
		todoAdapter?: TodoMutationAdapter,
		observation: TodoFileObservationAdapter | null = null,
		notices: ObservationNotices = {}
	) {
		this.workspace = workspace;
		this.observation = observation;
		this.notices = notices;
		this.todo = new TodoState(
			{
				replaceTodoFile: (todoFile) => this.workspace.replaceTodoFile(todoFile),
				refreshTodoFile: async () => {
					await this.workspace.refreshTodoFile();
					await this.syncObservationTarget();
				},
			},
			todoAdapter
		);
		this.todos = $derived(summarizeTodoFile(this.workspace.todoFile));
	}

	openWorkspaceCreationDialog = () => {
		this.isWorkspaceCreationDialogOpen = true;
	};

	restore = async () => {
		await this.workspace.restore();
		await this.syncObservationTarget();
	};

	create = async (input: CreateWorkspaceInput) => {
		await this.workspace.create(input);
		await this.syncObservationTarget();
	};

	open = async (workspaceId: string) => {
		await this.workspace.open(workspaceId);
		await this.syncObservationTarget();
	};

	delete = async (workspaceId: string) => {
		await this.workspace.delete(workspaceId);
		await this.syncObservationTarget();
	};

	private get isBusy() {
		return (
			this.workspace.isOperating || this.todo.isMutationPending || this.isObservationRefreshPending
		);
	}

	private handleObservationSignal = async () => {
		if (!this.observation || this.isBusy) return;
		if (this.workspace.session.status !== "ready") return;

		this.isObservationRefreshPending = true;
		const previousSummary = summarizeTodoFile(this.workspace.todoFile);
		try {
			await this.workspace.refreshTodoFile();
			// Re-read via getters so a Ready→Empty transition is not type-narrowed away.
			if (!this.workspace.todoFile && this.workspace.warning) {
				await delay(UNREADABLE_TODO_FILE_DEBOUNCE_MS);
				if (!this.workspace.isOperating && !this.todo.isMutationPending) {
					await this.workspace.refreshTodoFile();
				}
			}
			await this.syncObservationTarget();
			if (
				this.workspace.todoFile &&
				!todoFileSummariesEqual(previousSummary, summarizeTodoFile(this.workspace.todoFile))
			) {
				this.notices.onObservationSummaryChanged?.();
			}
		} finally {
			this.isObservationRefreshPending = false;
		}
	};

	private syncObservationTarget = async () => {
		if (!this.observation) return;

		const path = this.workspace.todoFile?.path ?? null;
		if (path === this.observedPath) return;

		try {
			if (path === null) {
				await this.observation.stop();
				this.observedPath = null;
				return;
			}

			if (this.observedPath === null) {
				await this.observation.start(path, this.handleObservationSignal);
			} else {
				await this.observation.retarget(path);
			}
			this.observedPath = path;
		} catch {
			// Todo-file observation is best-effort; session reload still works via mutations.
			try {
				await this.observation.stop();
			} catch {
				// Ignore stop failures after a failed start/retarget.
			}
			this.observedPath = null;
		}
	};
}

function todoFileSummariesEqual(left: TodoFileSummary, right: TodoFileSummary): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function delay(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
