import type { DesktopAPI, TodoFileObservation } from "@tuxedo/contracts";
import { tick } from "svelte";
import { AppState } from "#lib/app/app-state.svelte.js";
import { workspaceNavigation } from "#lib/app/workspace-navigation.svelte.js";
import { WorkspaceCommands } from "../workspace-commands.svelte";
import { SavedViewsResource } from "../saved-views-resource.svelte";
import {
	readSession,
	readWorkspace,
	readSavedViews,
	type SessionData,
	type WorkspaceData,
	type SavedViewsData,
} from "../workspace-route-data";

export function workspaceFixture(desktop: DesktopAPI) {
	let destination = $state<string>();
	let session = $state.raw<SessionData>();
	let workspace = $state.raw<WorkspaceData>();
	let views = $state.raw<SavedViewsData>();
	const loadViews = async (id: string) => {
		views = await readSavedViews(desktop, id, () => views);
	};
	const refresh = async (id: string | null, includeSession = false) => {
		if (includeSession) session = await readSession(desktop, () => session);
		if (id) workspace = await readWorkspace(desktop, id, () => workspace);
		await tick();
	};
	const routes = {
		session: () => session,
		workspace: () => workspace,
		destination: () => destination,
		navigating: () => false,
		refresh,
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
		refresh: loadViews,
	});
	async function navigate(id: string | undefined) {
		destination = id;
		await refresh(id ?? null, true);
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
		observe: (observation: TodoFileObservation, onChanged: () => void) =>
			commands.observe(observation, (changed) => {
				navigation.observed(changed);
				if (changed) onChanged();
			}),
		savedViews,
		start,
		reload: () => navigation.retry(),
		navigate: async (id: string | undefined) => {
			if (commands.isOperating) return { status: "rejected" as const, message: "Busy" };
			return navigate(id);
		},
	};
}
