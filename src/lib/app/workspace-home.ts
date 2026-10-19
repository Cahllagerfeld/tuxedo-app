import { resolve } from "$app/paths";

export function unavailableWorkspaceUrl(id: string) {
	return `${resolve("/workspaces")}?unavailable=${encodeURIComponent(id)}`;
}
