import { invoke } from "@tauri-apps/api/core";
import {
	parseWorkspaceCatalogueResponse,
	parseWorkspaceLoadResponse,
	type WorkspaceCatalogue,
	type WorkspaceLoadResult,
} from "$lib/modules/workspace/domain/workspace";

export async function loadWorkspaceCatalogue(): Promise<WorkspaceCatalogue> {
	return parseWorkspaceCatalogueResponse(await invoke("load_workspace_catalogue"));
}

export async function openWorkspace(workspaceId: string): Promise<WorkspaceLoadResult> {
	return parseWorkspaceLoadResponse(await invoke("open_workspace", { workspaceId }));
}

export async function deleteWorkspace(workspaceId: string): Promise<WorkspaceCatalogue> {
	return parseWorkspaceCatalogueResponse(await invoke("delete_workspace", { workspaceId }));
}

export async function createWorkspace(input: {
	name: string;
	color: WorkspaceCatalogue["workspaces"][number]["color"];
	todoPath: string;
}): Promise<WorkspaceLoadResult> {
	return parseWorkspaceLoadResponse(
		await invoke("create_workspace", {
			name: input.name,
			color: input.color,
			todoPath: input.todoPath,
		})
	);
}
