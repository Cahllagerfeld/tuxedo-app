import type { TodoFile } from "$lib/modules/todo/domain/todo";
import {
	createWorkspace,
	deleteWorkspace,
	loadWorkspaceCatalogue,
	openWorkspace,
} from "$lib/modules/workspace/api/workspace-api";
import type {
	Workspace,
	WorkspaceCatalogue,
	WorkspaceLoadResult,
} from "$lib/modules/workspace/domain/workspace";

type WorkspaceApi = {
	loadWorkspaceCatalogue: () => Promise<WorkspaceCatalogue>;
	openWorkspace: (workspaceId: string) => Promise<WorkspaceLoadResult>;
	deleteWorkspace: (workspaceId: string) => Promise<WorkspaceCatalogue>;
	createWorkspace: (input: CreateWorkspaceInput) => Promise<WorkspaceLoadResult>;
};

export type CreateWorkspaceInput = {
	name: string;
	color: Workspace["color"];
	todoPath: string;
};

const workspaceApi: WorkspaceApi = {
	loadWorkspaceCatalogue,
	openWorkspace,
	deleteWorkspace,
	createWorkspace,
};

export class WorkspaceState {
	catalogue = $state.raw<WorkspaceCatalogue | null>(null);
	activeWorkspace = $state.raw<Workspace | null>(null);
	todoFile = $state.raw<TodoFile | null>(null);
	error = $state("");
	warning = $state("");
	isLoading = $state(false);

	private readonly api: WorkspaceApi;

	constructor(api: Partial<WorkspaceApi> = {}) {
		this.api = { ...workspaceApi, ...api };
	}

	restore = async () => {
		this.error = "";
		this.warning = "";
		this.isLoading = true;

		try {
			this.catalogue = await this.api.loadWorkspaceCatalogue();
			const activeWorkspaceId = this.catalogue.active_workspace_id;
			if (!activeWorkspaceId) {
				this.clearLoadedWorkspace();
				return;
			}

			try {
				this.applyLoadResult(await this.api.openWorkspace(activeWorkspaceId));
			} catch (unknownError) {
				this.clearLoadedWorkspace();
				this.warning = `Saved workspace could not be opened: ${formatUnknownError(unknownError)}`;
			}
		} catch (unknownError) {
			this.clearLoadedWorkspace();
			this.error = formatUnknownError(unknownError);
		} finally {
			this.isLoading = false;
		}
	};

	create = async (input: CreateWorkspaceInput) => {
		this.error = "";
		this.warning = "";
		this.isLoading = true;

		try {
			const result = await this.api.createWorkspace(input);
			this.catalogue = {
				version: 1,
				active_workspace_id: result.workspace.id,
				workspaces: [
					...(this.catalogue?.workspaces.filter(({ id }) => id !== result.workspace.id) ?? []),
					result.workspace,
				],
			};
			this.applyLoadResult(result);
		} catch (unknownError) {
			this.error = formatUnknownError(unknownError);
			throw unknownError;
		} finally {
			this.isLoading = false;
		}
	};

	open = async (workspaceId: string) => {
		this.error = "";
		this.warning = "";
		this.isLoading = true;

		try {
			const result = await this.api.openWorkspace(workspaceId);
			if (this.catalogue) {
				this.catalogue = {
					...this.catalogue,
					active_workspace_id: result.workspace.id,
					workspaces: this.catalogue.workspaces.map((workspace) =>
						workspace.id === result.workspace.id ? result.workspace : workspace
					),
				};
			}
			this.applyLoadResult(result);
		} catch (unknownError) {
			this.error = `Could not open workspace: ${formatUnknownError(unknownError)}`;
		} finally {
			this.isLoading = false;
		}
	};

	delete = async (workspaceId: string) => {
		this.error = "";
		this.warning = "";
		this.isLoading = true;

		try {
			this.catalogue = await this.api.deleteWorkspace(workspaceId);
			if (this.activeWorkspace?.id === workspaceId) {
				this.clearLoadedWorkspace();
			}
		} catch (unknownError) {
			this.error = `Could not delete workspace: ${formatUnknownError(unknownError)}`;
		} finally {
			this.isLoading = false;
		}
	};

	private applyLoadResult(result: WorkspaceLoadResult) {
		this.activeWorkspace = result.workspace;
		this.todoFile = result.todo_file;
	}

	private clearLoadedWorkspace() {
		this.activeWorkspace = null;
		this.todoFile = null;
	}
}

function formatUnknownError(unknownError: unknown): string {
	return unknownError instanceof Error ? unknownError.message : String(unknownError);
}
