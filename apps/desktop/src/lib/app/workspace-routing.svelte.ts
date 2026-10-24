import { afterNavigate, beforeNavigate, goto, invalidate } from "$app/navigation";
import { page, navigating } from "$app/state";
import { resolve } from "$app/paths";
import { onMount } from "svelte";
import { toast } from "svelte-sonner";
import { WorkspaceCommands } from "#lib/modules/workspace/state/workspace-commands.svelte.js";
import {
	catalogueDependency,
	workspaceDependency,
} from "#lib/modules/workspace/state/workspace-route-data.js";

export function workspaceRouting() {
	const commands = new WorkspaceCommands(window.desktop, {
		catalogue: () => page.data.catalogue,
		workspace: () => page.data.workspace,
		destination: () => page.params.id,
		navigating: () => !!navigating.to,
		refresh: async (id, catalogue) => {
			await invalidate(
				(dependency) =>
					(catalogue && dependency.href === catalogueDependency) ||
					(!!id && dependency.href === workspaceDependency(id))
			);
		},
		navigate: (id, replace = false) =>
			goto(id ? resolve("/workspaces/[id]", { id }) : resolve("/"), { replace }),
	});
	beforeNavigate((navigation) => {
		if (navigation.shallow && navigation.type === "goto") return;

		// Window lifecycle is independent of renderer command admission.
		if (
			navigation.type !== "leave" &&
			!commands.beginNavigation(navigation.complete, navigation.to?.params?.id)
		)
			navigation.cancel();
	});
	afterNavigate((navigation) => {
		if (navigation.shallow && navigation.type === "goto") return;

		void commands
			.committedDestination(page.params.id, navigation.type === "enter")
			.then((outcome) => {
				if (outcome?.status === "applied" && outcome.notice) toast.warning(outcome.notice);
			});
	});
	onMount(() => commands.observe(window.desktop, () => toast.info("Todo file reloaded")));
	return commands;
}
