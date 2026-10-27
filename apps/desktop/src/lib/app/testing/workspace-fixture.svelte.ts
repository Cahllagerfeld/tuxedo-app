import type { DesktopAPI, TodoFileObservation } from "@tuxedo/contracts";
import { tick } from "svelte";
import { AppState } from "#lib/app/app-state.svelte.js";
import { workspaceNavigation } from "#lib/app/workspace-navigation.svelte.js";
import { WorkspaceCommands } from "#lib/modules/workspace/state/workspace-commands.svelte.js";
import { SavedViewsResource } from "#lib/modules/workspace/state/saved-views-resource.svelte.js";
import { observeTodoFileChanges } from "#lib/app/observation-invalidation.js";
import type { DisplayedDataTarget } from "#lib/modules/workspace/state/invalidate-displayed-data.js";
import {
	readSession,
	readWorkspace,
	readSavedViews,
	type SessionData,
	type WorkspaceData,
	type SavedViewsData,
} from "#lib/modules/workspace/state/workspace-route-data.js";

export function workspaceFixture(desktop: DesktopAPI) {
	let destination = $state<string>();
	let session = $state.raw<SessionData>();
	let workspace = $state.raw<WorkspaceData>();
	let views = $state.raw<SavedViewsData>();
	const loadViews = async (id: string) => {
		views = await readSavedViews(desktop, id, () => views);
	};
	const refresh = async ({ workspaceId: id, session: includeSession }: DisplayedDataTarget) => {
		if (includeSession) session = await readSession(desktop, () => session);
		if (id) workspace = await readWorkspace(desktop, id, () => workspace);
		await tick();
	};
	const routes = {
		session: () => session,
		workspace: () => workspace,
		destination: () => destination,
		navigating: () => false,
		invalidate: refresh,
	};
	const commands = new WorkspaceCommands(desktop, routes);
	const navigation = workspaceNavigation(commands, {
		...routes,
		navigate: async (id) => navigate(id ?? undefined),
	});
	const savedViews = new SavedViewsResource(desktop, commands, {
		workspaceId: () =>
			session?.value?.session.status !== "unavailable"
				? (session?.value?.session.catalogue.active_workspace_id ?? undefined)
				: undefined,
		current: () => views,
		invalidate: async ({ savedViewsId }) => {
			if (savedViewsId) await loadViews(savedViewsId);
		},
	});
	async function navigate(id: string | undefined) {
		destination = id;
		await refresh({ workspaceId: id ?? null, session: true });
		if (id) await loadViews(id);
		await navigation.committedDestination();
	}
	async function start() {
		session = await readSession(desktop, () => session);
		const current = session.value?.session;
		destination =
			current?.status === "ready"
				? (current.catalogue.active_workspace_id ?? undefined)
				: undefined;
		if (destination) {
			workspace = await readWorkspace(desktop, destination, () => workspace);
			await loadViews(destination);
		}
	}

	return {
		commands,
		routes,
		navigation,
		createApp: () => new AppState(commands, routes, navigation),
		observe: (observation: TodoFileObservation, reloaded: () => void) => {
			const stopFollowing = $effect.root(() => navigation.followDisplayedData(reloaded));
			const stop = observeTodoFileChanges(observation, refresh);
			return () => {
				stop();
				stopFollowing();
			};
		},
		savedViews,
		start,
		reload: () => navigation.retry(),
		navigate: async (id: string | undefined) => {
			if (commands.isOperating) return { status: "rejected" as const, message: "Busy" };
			return navigate(id);
		},
	};
}
