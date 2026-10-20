import { QueryClient, queryOptions } from "@tanstack/svelte-query";
import type { DesktopAPI, DesktopResponse } from "$lib/shared/desktop/contract";

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

export type WorkspaceDestination = Extract<DesktopResponse<"readWorkspace">, { status: "loaded" }>;

export const workspaceDestinationQuery = (desktop: DesktopAPI, workspaceId: string) =>
	queryOptions({
		queryKey: workspaceQueryKeys.destination(workspaceId),
		queryFn: async (): Promise<WorkspaceDestination> => {
			const outcome = await desktop.readWorkspace({ workspaceId });
			if (outcome.status !== "loaded") throw Error(outcome.message);
			return outcome;
		},
	});
