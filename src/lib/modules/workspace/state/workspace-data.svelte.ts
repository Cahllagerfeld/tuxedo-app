import { QueryObserver, type QueryClient, type QueryObserverResult } from "@tanstack/svelte-query";
import type { ConfirmedSession, DesktopAPI, SavedView } from "$lib/shared/desktop/contract";
import {
	workspaceSessionQuery,
	workspaceViewsQuery,
	workspaceQueryKeys,
	workspaceDestinationQuery,
} from "./workspace-queries";

export class WorkspaceData {
	private sessionResult = $state.raw<QueryObserverResult<ConfirmedSession>>();
	private viewsResult = $state.raw<QueryObserverResult<readonly SavedView[]>>();
	private destinationResult = $state.raw<{
		id: string;
		result: QueryObserverResult<ConfirmedSession>;
	}>();
	private readonly unsubscribe: (() => void)[];

	constructor(
		private readonly desktop: DesktopAPI,
		private readonly queryClient: QueryClient,
		private readonly getWorkspaceId: () => string | undefined = () => undefined
	) {
		const session = new QueryObserver(queryClient, workspaceSessionQuery(desktop));
		const views = new QueryObserver(queryClient, workspaceViewsQuery(desktop));
		this.sessionResult = session.getCurrentResult();
		this.viewsResult = views.getCurrentResult();
		this.unsubscribe = [
			session.subscribe((result) => {
				this.sessionResult = result;
			}),
			views.subscribe((result) => {
				this.viewsResult = result;
			}),
		];
	}

	observeDestination(id: string | undefined) {
		if (!id) return;
		const observer = new QueryObserver(
			this.queryClient,
			workspaceDestinationQuery(this.desktop, id)
		);
		this.destinationResult = { id, result: observer.getCurrentResult() };
		const unsubscribe = observer.subscribe((result) => {
			this.destinationResult = { id, result };
		});
		return () => {
			unsubscribe();
			if (this.destinationResult?.id === id) this.destinationResult = undefined;
		};
	}

	destroy() {
		this.unsubscribe.forEach((unsubscribe) => unsubscribe());
	}
	get routeWorkspaceId() {
		return this.getWorkspaceId();
	}
	get confirmed() {
		const id = this.routeWorkspaceId;
		if (!id) return this.sessionResult?.data;
		const destination =
			this.destinationResult?.id === id
				? this.destinationResult.result.data
				: this.queryClient.getQueryData<ConfirmedSession>(workspaceQueryKeys.destination(id));
		if (destination) return destination;
		const fallback = this.sessionResult?.data;
		return fallback?.session.status === "ready" &&
			fallback.session.catalogue.active_workspace_id === id
			? fallback
			: undefined;
	}
	get session() {
		return this.confirmed?.session ?? { status: "unavailable" as const, error: this.error };
	}
	get catalogue() {
		return this.session.status === "ready" || this.session.status === "empty"
			? this.session.catalogue
			: null;
	}
	get activeWorkspace() {
		return (
			this.catalogue?.workspaces.find(
				(workspace) => workspace.id === this.catalogue?.active_workspace_id
			) ?? null
		);
	}
	get todoFile() {
		return this.session.status === "ready" ? this.session.todo_file : null;
	}
	get undoLabel() {
		return this.session.status === "ready" ? this.confirmed?.undoLabel : undefined;
	}
	get error() {
		const id = this.routeWorkspaceId;
		const destinationError =
			this.destinationResult?.id === id
				? this.destinationResult?.result.error
				: id
					? this.queryClient.getQueryState(workspaceQueryKeys.destination(id))?.error
					: undefined;
		return (
			destinationError?.message ??
			this.sessionResult?.error?.message ??
			(this.confirmed?.session.status === "unavailable" ? this.confirmed.session.error : "")
		);
	}
	get warning() {
		return this.session.status === "empty" ? (this.session.warning ?? "") : "";
	}
	get savedViews() {
		return this.viewsResult?.data ?? [];
	}
	get savedViewsError() {
		return this.viewsResult?.error?.message ?? "";
	}
}
