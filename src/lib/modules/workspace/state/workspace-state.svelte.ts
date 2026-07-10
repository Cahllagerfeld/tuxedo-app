import type { TodoFile } from "$lib/modules/todo/domain/todo";
import { loadWorkspaceCatalogue, openWorkspace } from "$lib/modules/workspace/api/workspace-api";
import type {
	Workspace,
	WorkspaceCatalogue,
	WorkspaceLoadResult,
} from "$lib/modules/workspace/domain/workspace";

type WorkspaceApi = {
	loadWorkspaceCatalogue: () => Promise<WorkspaceCatalogue>;
	openWorkspace: (workspaceId: string) => Promise<WorkspaceLoadResult>;
};

const workspaceApi: WorkspaceApi = { loadWorkspaceCatalogue, openWorkspace };

export class WorkspaceState {
	catalogue = $state.raw<WorkspaceCatalogue | null>(null);
	activeWorkspace = $state.raw<Workspace | null>(null);
	todoFile = $state.raw<TodoFile | null>(null);
	error = $state("");
	warning = $state("");
	isLoading = $state(false);

	constructor(private readonly api: WorkspaceApi = workspaceApi) {}

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
