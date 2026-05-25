import type { TodoFile } from "$lib/todo";
import {
	parseWorkspaceConfigResponse,
	parseWorkspaceLoadResponse,
	type WorkspaceLoadResult,
} from "$lib/workspace";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

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
			const response = await invoke("load_workspace_config");
			const config = parseWorkspaceConfigResponse(response);
			this.root = config.root;

			if (!config.root) {
				this.todoPath = null;
				this.todoFile = null;
				return;
			}

			await this.load(config.root);
		} catch (unknownError) {
			this.error = formatUnknownError(unknownError);
		} finally {
			this.isLoading = false;
		}
	};

	openDirectory = async () => {
		this.error = "";
		this.warning = "";
		this.isLoading = true;

		try {
			const root = await open({
				multiple: false,
				directory: true,
			});

			if (!root) {
				return;
			}

			const response = await invoke("save_workspace_config", { root });
			const config = parseWorkspaceConfigResponse(response);

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
		const response = await invoke("load_workspace", { root });
		const workspace = parseWorkspaceLoadResponse(response);
		this.applyLoadResult(workspace);
	};

	private applyLoadResult(workspace: WorkspaceLoadResult) {
		this.root = workspace.root;
		this.todoPath = workspace.todo_path;
		this.todoFile = workspace.todo_file;
		this.warning = workspace.todo_exists
			? ""
			: `No todo.txt file was found in ${workspace.root}. Add one there or choose another directory.`;
	}
}

function formatUnknownError(unknownError: unknown): string {
	return unknownError instanceof Error ? unknownError.message : String(unknownError);
}
