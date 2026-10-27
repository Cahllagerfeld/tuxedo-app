import { afterNavigate, beforeNavigate, goto } from "$app/navigation";
import { page, navigating } from "$app/state";
import { resolve } from "$app/paths";
import { onMount } from "svelte";
import { toast } from "svelte-sonner";
import { WorkspaceCommands } from "#lib/modules/workspace/state/workspace-commands.svelte.js";
import { SavedViewsResource } from "#lib/modules/workspace/state/saved-views-resource.svelte.js";
import { invalidateDisplayedData } from "#lib/modules/workspace/state/invalidate-displayed-data.js";
import { workspaceNavigation } from "./workspace-navigation.svelte.js";
import { observationInvalidation } from "./observation-invalidation.js";

export function workspaceRouting() {
	const routes = {
		session: () => page.data.session,
		workspace: () => page.data.workspace,
		destination: () => page.params.id,
		navigating: () => !!navigating.to,
		invalidate: invalidateDisplayedData,
	};
	const commands = new WorkspaceCommands(window.desktop, routes);
	const observation = observationInvalidation(commands, routes);
	const navigation = workspaceNavigation(commands, {
		...routes,
		flushObservation: observation.flush,
		navigate: (id, replace = false) =>
			goto(id ? resolve("/workspaces/[id]", { id }) : resolve("/"), { replace }),
	});
	const savedViews = new SavedViewsResource(window.desktop, commands, {
		workspaceId: routes.destination,
		current: () => page.data.savedViews,
		invalidate: invalidateDisplayedData,
	});
	beforeNavigate((navigation) => {
		if (navigation.shallow && navigation.type === "goto") return;

		// Window lifecycle is independent of renderer command admission.
		if (navigation.type !== "leave" && commands.pendingOperation !== null) navigation.cancel();
	});
	afterNavigate((event) => {
		if (event.shallow && event.type === "goto") return;

		void navigation.committedDestination(event.type === "enter");
	});
	onMount(() =>
		observation.observe(window.desktop, (changed) => {
			if (changed) toast.info("Todo file reloaded");
			navigation.observed(changed);
		})
	);
	return { workspace: commands, savedViews, routes, navigation };
}
