import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
	parseWorkspaceConfigResponse,
	parseWorkspaceLoadResponse,
	parseWorkspaceMutationResponse,
	type WorkspaceConfig,
	type WorkspaceLoadResult,
	type WorkspaceMutationResult,
} from "$lib/modules/workspace/domain/workspace";

export async function loadWorkspaceConfig(): Promise<WorkspaceConfig> {
	const response = await invoke("load_workspace_config");
	return parseWorkspaceConfigResponse(response);
}

export async function chooseWorkspaceDirectory(): Promise<string | null> {
	const root = await open({
		multiple: false,
		directory: true,
	});

	return typeof root === "string" ? root : null;
}

export async function loadWorkspace(root: string): Promise<WorkspaceLoadResult> {
	const response = await invoke("load_workspace", { root });
	return parseWorkspaceLoadResponse(response);
}

export async function saveWorkspaceConfig(root: string): Promise<WorkspaceConfig> {
	const response = await invoke("save_workspace_config", { root });
	return parseWorkspaceConfigResponse(response);
}

export async function appendTodoItem(root: string, raw: string): Promise<WorkspaceMutationResult> {
	const response = await invoke("append_todo_item", { root, raw });
	return parseWorkspaceMutationResponse(response);
}

export async function updateTodoItem(
	root: string,
	lineNumber: number,
	expectedRaw: string,
	raw: string
): Promise<WorkspaceMutationResult> {
	const response = await invoke("update_todo_item", {
		root,
		lineNumber,
		expectedRaw,
		raw,
	});
	return parseWorkspaceMutationResponse(response);
}

export async function toggleTodoItemCompleted(
	root: string,
	lineNumber: number,
	expectedRaw: string
): Promise<WorkspaceMutationResult> {
	const response = await invoke("toggle_todo_item_completed", {
		root,
		lineNumber,
		expectedRaw,
	});
	return parseWorkspaceMutationResponse(response);
}
