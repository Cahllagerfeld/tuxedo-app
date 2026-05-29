import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
	parseWorkspaceConfigResponse,
	parseWorkspaceLoadResponse,
	type WorkspaceConfig,
	type WorkspaceLoadResult,
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
