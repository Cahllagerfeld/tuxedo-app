import { QueryClient, queryOptions } from "@tanstack/svelte-query";
import type { DesktopAPI } from "$lib/shared/desktop/contract";

const all = ["workspace"] as const;
const destinations = [...all, "destination"] as const;
export const workspaceQueryKeys = {
	all,
	session: [...all, "session"] as const,
	views: [...all, "views"] as const,
	destinations,
	destination: (workspaceId: string) => [...destinations, workspaceId] as const,
};

export function createWorkspaceQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: Infinity,
				retry: false,
				networkMode: "always",
				refetchOnWindowFocus: false,
				refetchOnMount: false,
				retryOnMount: false,
				refetchOnReconnect: false,
			},
			mutations: { retry: false, networkMode: "always" },
		},
	});
}

export const workspaceSessionQuery = (desktop: DesktopAPI) =>
	queryOptions({
		queryKey: workspaceQueryKeys.session,
		queryFn: () => desktop.readSession({}),
	});

export const workspaceViewsQuery = (desktop: DesktopAPI) =>
	queryOptions({
		queryKey: workspaceQueryKeys.views,
		queryFn: async () => {
			const outcome = await desktop.readSavedViews({});
			if (outcome.status !== "applied") throw Error(outcome.message);
			return outcome.views;
		},
	});

export const workspaceDestinationQuery = (desktop: DesktopAPI, workspaceId: string) =>
	queryOptions({
		queryKey: workspaceQueryKeys.destination(workspaceId),
		queryFn: async () => {
			const confirmed = await desktop.readSession({});
			if (
				confirmed.session.status === "ready" &&
				confirmed.session.catalogue.active_workspace_id !== workspaceId
			)
				throw Error("The requested Workspace is not active.");
			return confirmed;
		},
	});
