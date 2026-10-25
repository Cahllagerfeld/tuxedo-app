import { afterNavigate, beforeNavigate, goto } from "$app/navigation";
import { page, navigating } from "$app/state";
import { resolve } from "$app/paths";
import { onMount } from "svelte";
import { toast } from "svelte-sonner";
import { WorkspaceCommands } from "#lib/modules/workspace/state/workspace-commands.svelte.js";
import { SavedViewsResource } from "#lib/modules/workspace/state/saved-views-resource.svelte.js";

export function workspaceRouting() {
	const commands = new WorkspaceCommands(window.desktop, {
		destination: () => page.params.id,
		navigating: () => !!navigating.to,
		navigate: (id, replace = false) =>
			goto(id ? resolve("/workspaces/[id]", { id }) : resolve("/"), { replace }),
	});
	const savedViews = new SavedViewsResource(window.desktop, commands);
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

		commands.acceptLoadedSession(page.data.session);
		const loadedViews = page.data.savedViews;
		if (loadedViews && loadedViews.workspaceId === page.params.id)
			savedViews.acceptLoaded(loadedViews.workspaceId, loadedViews.outcome);
		void commands
			.committedDestination(page.params.id, navigation.type === "enter")
			.then((outcome) => {
				if (outcome?.status === "applied" && outcome.notice) toast.warning(outcome.notice);
			});
	});
	onMount(() => commands.observe(window.desktop, () => toast.info("Todo file reloaded")));
	return { workspace: commands, savedViews };
}
