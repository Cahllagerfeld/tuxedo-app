import type { DesktopAPI } from "@tuxedo/contracts";
import { tick } from "svelte";
import { WorkspaceCommands } from "../workspace-commands.svelte";

export function workspaceFixture(desktop: DesktopAPI) {
	let destination = $state<string>();
	const commands = new WorkspaceCommands(desktop, {
		destination: () => destination,
		navigating: () => false,
		navigate: async (id) => {
			destination = id ?? undefined;
			await commands.committedDestination(destination);
		},
	});
	async function start() {
		commands.acceptLoadedSession({ value: await desktop.readSession({}), error: "" });
		destination = commands.session.status === "ready" ? commands.activeWorkspace?.id : undefined;
	}

	return {
		commands,
		start,
		reload: () => commands.retry(),
		navigate: async (id: string | undefined) => {
			if (commands.isOperating) return { status: "rejected" as const, message: "Busy" };
			destination = id;
			// Like afterNavigate, commit after the triggering UI event has closed its menu.
			await tick();
			return commands.committedDestination(id);
		},
	};
}
