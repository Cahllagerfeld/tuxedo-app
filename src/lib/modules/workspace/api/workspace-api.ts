import { invoke } from "@tauri-apps/api/core";
import type { Workspace } from "$lib/modules/workspace/domain/workspace";

export async function restoreWorkspaceSession(): Promise<unknown> {
	return invoke("restore_workspace_session");
}

export async function switchWorkspace(workspaceId: string): Promise<unknown> {
	return invoke("switch_workspace", { workspaceId });
}

export async function deleteWorkspace(workspaceId: string): Promise<unknown> {
	return invoke("delete_workspace", { workspaceId });
}

export async function createWorkspace(input: {
	name: string;
	color: Workspace["color"];
	todoPath: string;
}): Promise<unknown> {
	return invoke("create_workspace", {
		name: input.name,
		color: input.color,
		todoPath: input.todoPath,
	});
}
