import { afterNavigate, beforeNavigate, goto, invalidate } from "$app/navigation";
import { page, navigating } from "$app/state";
import { resolve } from "$app/paths";
import {
	panelRouting,
	setPanelRouting,
} from "#lib/modules/workspace/ui/todo-panel-routing.svelte.js";
import { onMount } from "svelte";
import { toast } from "svelte-sonner";
import { WorkspaceCommands } from "#lib/modules/workspace/state/workspace-commands.svelte.js";
import { SavedViewsResource } from "#lib/modules/workspace/state/saved-views-resource.svelte.js";
import { workspaceNavigation } from "./workspace-navigation.svelte.js";
import {
	sessionDependency,
	workspaceDependency,
	savedViewsDependency,
} from "#lib/modules/workspace/state/workspace-route-data.js";

export function workspaceRouting() {
	const routes = {
		session: () => page.data.session,
		workspace: () => page.data.workspace,
		destination: () => page.params.id,
		navigating: () => !!navigating.to,
		refresh: (id: string | null, session = false) =>
			invalidate(
				(dependency) =>
					(session && dependency.href === sessionDependency) ||
					(!!id && dependency.href === workspaceDependency(id)),
				true
			),
	};
	const commands = new WorkspaceCommands(window.desktop, routes);
	const navigation = workspaceNavigation(commands, {
		...routes,
		navigate: (id, replace = false) =>
			goto(id ? resolve("/workspaces/[id]", { id }) : resolve("/"), { replace }),
	});
	const savedViews = new SavedViewsResource(window.desktop, commands, {
		workspaceId: routes.destination,
		current: () => page.data.savedViews,
		refresh: (id) => invalidate(savedViewsDependency(id), true),
	});
	setPanelRouting(
		panelRouting(
			{
				url: () => new URL((page.shallow?.url ?? page.url).href),
				state: () => page.state,
				update: (url, state) => goto(url, { state, replace: true, shallow: true }),
			},
			() => commands.isOperating
		)
	);
	beforeNavigate((navigation) => {
		// Window lifecycle is independent of renderer command admission.
		if (navigation.type !== "leave" && commands.pendingOperation !== null) navigation.cancel();
	});
	afterNavigate((event) => {
		if (event.shallow && event.type === "goto") return;

		void navigation.committedDestination(event.type === "enter");
	});
	onMount(() =>
		commands.observe(window.desktop, (changed) => {
			if (changed) toast.info("Todo file reloaded");
			navigation.observed(changed);
		})
	);
	return { workspace: commands, savedViews, routes, navigation };
}
