import type { DesktopAPI } from "@tuxedo/contracts";

export const readConfirmation = (backend: Pick<DesktopAPI, "readSession">) =>
	backend.readSession({});

export async function activateWorkspace(
	backend: Pick<DesktopAPI, "switchWorkspace">,
	workspaceId: string
) {
	const activated = await backend.switchWorkspace({ workspaceId });
	if (activated.status !== "applied") throw Error(activated.message);
	return activated.confirmed;
}
