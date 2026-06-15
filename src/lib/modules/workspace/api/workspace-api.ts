import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
	parseWorkspaceConfigResponse,
	parseWorkspaceTodoResolutionResponse,
	type WorkspaceConfig,
	type WorkspaceTodoResolution,
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

export async function resolveWorkspaceTodo(root: string): Promise<WorkspaceTodoResolution> {
	const response = await invoke("resolve_workspace_todo", { root });
	return parseWorkspaceTodoResolutionResponse(response);
}

export async function saveWorkspaceConfig(root: string): Promise<WorkspaceConfig> {
	const response = await invoke("save_workspace_config", { root });
	return parseWorkspaceConfigResponse(response);
}
