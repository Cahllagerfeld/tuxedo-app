import { invoke } from "@tauri-apps/api/core";
import type {
	Workspace,
	WorkspaceSessionOperationOutcome,
	WorkspaceSessionSnapshot,
} from "$lib/modules/workspace/domain/workspace";

export async function restoreWorkspaceSession(): Promise<WorkspaceSessionSnapshot> {
	return invoke<WorkspaceSessionSnapshot>("restore_workspace_session");
}

export async function switchWorkspace(
	workspaceId: string
): Promise<WorkspaceSessionOperationOutcome> {
	return invoke<WorkspaceSessionOperationOutcome>("switch_workspace", { workspaceId });
}

export async function deleteWorkspace(
	workspaceId: string
): Promise<WorkspaceSessionOperationOutcome> {
	return invoke<WorkspaceSessionOperationOutcome>("delete_workspace", { workspaceId });
}

export async function createWorkspace(input: {
	name: string;
	color: Workspace["color"];
	todoPath: string;
}): Promise<WorkspaceSessionOperationOutcome> {
	return invoke<WorkspaceSessionOperationOutcome>("create_workspace", {
		name: input.name,
		color: input.color,
		todoPath: input.todoPath,
	});
}
