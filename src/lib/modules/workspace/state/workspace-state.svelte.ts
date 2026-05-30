import type { TodoFile } from "$lib/modules/todo/domain/todo";
import {
	chooseWorkspaceDirectory,
	loadWorkspace,
	loadWorkspaceConfig,
	saveWorkspaceEntry,
	setActiveWorkspace,
} from "$lib/modules/workspace/api/workspace-api";
import {
	type WorkspaceConfig,
	type WorkspaceEntry,
	type WorkspaceLoadResult,
} from "$lib/modules/workspace/domain/workspace";

export class WorkspaceState {
	activeWorkspace = $state.raw<WorkspaceEntry | null>(null);
	recentWorkspaces = $state.raw<WorkspaceEntry[]>([]);
	todoPath = $state<string | null>(null);
	todoFile = $state.raw<TodoFile | null>(null);
	warning = $state("");
	error = $state("");
	isLoading = $state(false);
	root = $derived(this.activeWorkspace?.root ?? null);

	restore = async () => {
		this.error = "";
		this.warning = "";
		this.isLoading = true;

		try {
			const config = await loadWorkspaceConfig();
			this.applyConfig(config);

			if (!this.activeWorkspace) {
				this.clearLoadedTodo();
				return;
			}

			await this.load(this.activeWorkspace.root);
		} catch (unknownError) {
			this.error = formatUnknownError(unknownError);
		} finally {
			this.isLoading = false;
		}
	};

	openDirectory = async () => {
		try {
			const root = await chooseWorkspaceDirectory();

			if (!root) {
				return;
			}

			this.error = "";
			this.warning = "";
			this.isLoading = true;

			const config = await saveWorkspaceEntry(root);
			this.applyConfig(config);

			if (this.activeWorkspace) {
				await this.load(this.activeWorkspace.root);
			}
		} catch (unknownError) {
			this.error = formatUnknownError(unknownError);
		} finally {
			this.isLoading = false;
		}
	};

	switchWorkspace = async (id: string) => {
		this.error = "";
		this.warning = "";
		this.isLoading = true;

		try {
			const config = await setActiveWorkspace(id);
			this.applyConfig(config);

			if (this.activeWorkspace) {
				await this.load(this.activeWorkspace.root);
			}
		} catch (unknownError) {
			this.error = formatUnknownError(unknownError);
		} finally {
			this.isLoading = false;
		}
	};

	load = async (root: string) => {
		const workspace = await loadWorkspace(root);
		this.applyLoadResult(workspace);
	};

	private applyConfig(config: WorkspaceConfig) {
		this.recentWorkspaces = config.recent_workspaces;
		this.activeWorkspace =
			config.recent_workspaces.find((workspace) => workspace.id === config.active_workspace_id) ??
			config.recent_workspaces[0] ??
			null;
	}

	private applyLoadResult(workspace: WorkspaceLoadResult) {
		this.todoPath = workspace.todo_path;
		this.todoFile = workspace.todo_file;
		this.warning = workspace.todo_exists
			? ""
			: `No todo.txt file was found in ${workspace.root}. Add one there or choose another directory.`;
	}

	private clearLoadedTodo() {
		this.todoPath = null;
		this.todoFile = null;
	}
}

function formatUnknownError(unknownError: unknown): string {
	return unknownError instanceof Error ? unknownError.message : String(unknownError);
}
