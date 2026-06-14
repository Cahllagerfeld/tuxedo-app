import type { TodoFile } from "$lib/modules/todo/domain/todo";
import {
	chooseWorkspaceDirectory,
	loadWorkspace,
	loadWorkspaceConfig,
	saveWorkspaceConfig,
	toggleTodoItemCompleted as toggleTodoItemCompletedApi,
} from "$lib/modules/workspace/api/workspace-api";
import { type WorkspaceLoadResult } from "$lib/modules/workspace/domain/workspace";

export class WorkspaceState {
	root = $state<string | null>(null);
	todoPath = $state<string | null>(null);
	todoFile = $state.raw<TodoFile | null>(null);
	warning = $state("");
	error = $state("");
	isLoading = $state(false);

	restore = async () => {
		this.error = "";
		this.warning = "";
		this.isLoading = true;

		try {
			const config = await loadWorkspaceConfig();
			this.root = config.root;

			if (!config.root) {
				this.clearLoadedWorkspace();
				return;
			}

			await this.load(config.root);
		} catch (unknownError) {
			this.error = formatUnknownError(unknownError);
			this.todoPath = null;
			this.todoFile = null;
		} finally {
			this.isLoading = false;
		}
	};

	openDirectory = async () => {
		this.error = "";
		this.warning = "";
		this.isLoading = true;

		try {
			const root = await chooseWorkspaceDirectory();

			if (!root) {
				return;
			}

			const config = await saveWorkspaceConfig(root);

			if (config.root) {
				await this.load(config.root);
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

	toggleTodoItemCompleted = async (lineNumber: number, expectedRaw: string) => {
		if (!this.root) {
			this.error = "No workspace is open.";
			return;
		}

		this.error = "";

		try {
			const workspace = await toggleTodoItemCompletedApi(this.root, lineNumber, expectedRaw);
			this.applyLoadResult(workspace);
		} catch (unknownError) {
			this.error = formatUnknownError(unknownError);
		}
	};

	private applyLoadResult(workspace: WorkspaceLoadResult) {
		this.root = workspace.root;
		this.todoPath = workspace.todo_path;
		this.todoFile = workspace.todo_file;
		this.warning = workspace.todo_exists
			? ""
			: `No todo.txt file was found in ${workspace.root}. Add one there or choose another directory.`;
	}

	private clearLoadedWorkspace() {
		this.root = null;
		this.todoPath = null;
		this.todoFile = null;
	}
}

function formatUnknownError(unknownError: unknown): string {
	return unknownError instanceof Error ? unknownError.message : String(unknownError);
}
