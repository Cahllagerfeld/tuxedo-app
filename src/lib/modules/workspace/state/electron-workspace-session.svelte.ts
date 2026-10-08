import { createMutation, createQuery, QueryClient } from "@tanstack/svelte-query";
import {
	confirmedSessionSchema,
	type ConfirmedSession,
	type DesktopAPI,
} from "$lib/shared/desktop/contract";
import type {
	WorkspaceSessionActionResult,
	WorkspaceSessionOperation,
} from "./workspace-session-state.svelte";
import type { TodoItem } from "$lib/modules/todo/domain/todo";
const sessionKey = ["desktop", "workspace-session"] as const;
export function reconcileConfirmedSession(
	previous: ConfirmedSession | undefined,
	incoming: ConfirmedSession
): ConfirmedSession {
	const parsed = confirmedSessionSchema.parse(incoming);
	if (previous && (previous.scope !== parsed.scope || previous.revision > parsed.revision))
		return previous;
	return parsed;
}
export class ElectronWorkspaceSessionState {
	readonly client = new QueryClient({
		defaultOptions: {
			queries: {
				networkMode: "always",
				retry: false,
				staleTime: Infinity,
				refetchOnWindowFocus: false,
				refetchOnReconnect: false,
				refetchOnMount: false,
				refetchInterval: false,
			},
			mutations: { networkMode: "always", retry: false },
		},
	});
	private readonly query;
	private readonly restoration;
	constructor(private readonly desktop: DesktopAPI) {
		this.query = createQuery(
			() => ({
				queryKey: sessionKey,
				queryFn: () => desktop.readSession({}),
				structuralSharing: (previous, incoming) =>
					reconcileConfirmedSession(
						previous as ConfirmedSession | undefined,
						incoming as ConfirmedSession
					),
			}),
			() => this.client
		);
		this.restoration = createMutation(
			() => ({
				mutationFn: () => desktop.restoreSession({}),
				onSuccess: (incoming: ConfirmedSession) =>
					this.client.setQueryData<ConfirmedSession>(sessionKey, (previous) =>
						reconcileConfirmedSession(previous, incoming)
					),
			}),
			() => this.client
		);
	}
	get session() {
		return this.query.error
			? { status: "unavailable" as const, error: this.query.error.message }
			: (this.query.data?.session ?? { status: "loading" as const });
	}
	get isLoading() {
		return this.query.isPending;
	}
	get pendingOperation(): WorkspaceSessionOperation | null {
		return this.restoration.isPending ? "restore" : null;
	}
	get isOperating() {
		return this.restoration.isPending;
	}
	get catalogue() {
		return this.session.status === "empty" ? this.session.catalogue : null;
	}
	get activeWorkspace() {
		return (
			this.catalogue?.workspaces.find((w) => w.id === this.catalogue?.active_workspace_id) ?? null
		);
	}
	get todoFile() {
		return null;
	}
	get error() {
		return (
			this.query.error?.message ?? (this.session.status === "unavailable" ? this.session.error : "")
		);
	}
	get warning() {
		return this.session.status === "empty" ? (this.session.warning ?? "") : "";
	}
	restore = async () => {
		await this.restoration.mutateAsync();
	};
	private unavailable = async (): Promise<WorkspaceSessionActionResult> => ({
		status: "rejected",
		message: "This operation is not available yet in the Electron migration.",
	});
	create = (_input: unknown) => this.unavailable();
	open = (_id: string) => this.unavailable();
	deleteWorkspace = (_id: string) => this.unavailable();
	setCompletion = (_todo: TodoItem) => this.unavailable();
	deleteTodo = (_todo: TodoItem) => this.unavailable();
}
