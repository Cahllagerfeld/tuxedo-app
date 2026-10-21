import type { DesktopAPI, TodoFileObservation } from "@tuxedo/contracts";
import { WorkspaceCommands } from "../workspace-commands.svelte";
import {
	readCatalogue,
	readWorkspace,
	type CatalogueData,
	type WorkspaceData,
} from "../workspace-route-data";

export function workspaceRouteFixture(desktop: DesktopAPI) {
	let catalogue = $state.raw<CatalogueData>();
	let workspace = $state.raw<WorkspaceData>();
	let destination = $state<string>();
	async function publish(id = destination, shared = true) {
		if (shared) catalogue = await readCatalogue(desktop, () => catalogue);
		if (id) workspace = await readWorkspace(desktop, id, () => workspace);
	}
	const commands = new WorkspaceCommands(desktop, {
		catalogue: () => catalogue,
		workspace: () => workspace,
		destination: () => destination,
		navigating: () => false,
		refresh: (id, shared) => publish(id ?? undefined, shared),
		navigate: async (id) => {
			destination = id ?? undefined;
			await publish();
			await commands.committedDestination(destination);
		},
	});
	async function loadDestination() {
		catalogue = await readCatalogue(desktop, () => catalogue);
		destination = catalogue?.value?.selection?.workspaceId ?? undefined;
		const remembered = destination ?? catalogue?.value?.catalogue.active_workspace_id;
		if (remembered) {
			workspace = await readWorkspace(desktop, remembered, () => workspace);
			commands.destinationError = workspace.error;
		}
	}

	return {
		commands,
		observe: (observation: TodoFileObservation) => observation,
		start: loadDestination,
		reload: loadDestination,
		navigate: async (id: string) => {
			if (commands.isOperating) return { status: "rejected" as const, message: "Busy" };
			destination = id;
			await publish();
			return commands.committedDestination(id);
		},
	};
}
