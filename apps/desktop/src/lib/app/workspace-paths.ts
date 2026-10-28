import { resolve } from "$app/paths";
import type { WorkspaceViewMode } from "#lib/modules/workspace/domain/workspace.js";

export function workspaceViewMode(routeId: string | null | undefined): WorkspaceViewMode {
	return routeId === "/workspaces/[id]/kanban" ? "kanban" : "list";
}

export function workspacePath(id: string, mode: WorkspaceViewMode): string {
	return mode === "kanban"
		? resolve("/workspaces/[id]/kanban", { id })
		: resolve("/workspaces/[id]", { id });
}
