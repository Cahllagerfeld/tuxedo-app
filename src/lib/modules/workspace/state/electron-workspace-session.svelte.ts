import { createMutation, createQuery, QueryClient } from "@tanstack/svelte-query";
import {
	confirmedSessionSchema,
	confirmedTodoSchema,
	type ConfirmedTodo,
	type ConfirmedSession,
	type DesktopAPI,
	type DesktopRequest,
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
export function reconcileConfirmedTodo(
	previous: ConfirmedSession | undefined,
	incoming: ConfirmedTodo
): ConfirmedSession | undefined {
	const parsed = confirmedTodoSchema.parse(incoming);
	if (
		!previous ||
		previous.scope !== parsed.scope ||
		previous.revision > parsed.revision ||
		previous.session.status !== "ready" ||
		previous.session.catalogue.active_workspace_id !== parsed.workspaceId ||
		previous.session.todo_file.path !== parsed.todo_file.path
	)
		return previous;
	return {
		...previous,
		revision: parsed.revision,
		session: { ...previous.session, todo_file: parsed.todo_file },
	};
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
	private readonly creation;
	private readonly switching;
	private readonly completion;
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
		this.creation = createMutation(
			() => ({
				mutationFn: (input: DesktopRequest<"createWorkspace">) => desktop.createWorkspace(input),
				onSuccess: (outcome) => {
					if (outcome.status === "applied")
						this.client.setQueryData<ConfirmedSession>(sessionKey, (previous) =>
							reconcileConfirmedSession(previous, outcome.confirmed)
						);
				},
			}),
			() => this.client
		);
		this.switching = createMutation(
			() => ({
				mutationFn: (input: DesktopRequest<"switchWorkspace">) => desktop.switchWorkspace(input),
				onSuccess: (outcome) => {
					if (outcome.status === "applied")
						this.client.setQueryData<ConfirmedSession>(sessionKey, (previous) =>
							reconcileConfirmedSession(previous, outcome.confirmed)
						);
				},
			}),
			() => this.client
		);
		this.completion = createMutation(
			() => ({
				mutationFn: (input: DesktopRequest<"setTodoCompletion">) =>
					desktop.setTodoCompletion(input),
				onSuccess: (outcome) => {
					if (outcome.status !== "rejected")
						this.client.setQueryData<ConfirmedSession>(sessionKey, (previous) =>
							reconcileConfirmedTodo(previous, outcome.confirmed)
						);
				},
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
		return this.restoration.isPending
			? "restore"
			: this.creation.isPending
				? "create_workspace"
				: this.switching.isPending
					? "open_workspace"
					: this.completion.isPending
						? "set_todo_item_completion"
						: null;
	}
	get isOperating() {
		return (
			this.restoration.isPending ||
			this.creation.isPending ||
			this.switching.isPending ||
			this.completion.isPending
		);
	}
	get catalogue() {
		return this.session.status === "empty" || this.session.status === "ready"
			? this.session.catalogue
			: null;
	}
	get activeWorkspace() {
		return (
			this.catalogue?.workspaces.find((w) => w.id === this.catalogue?.active_workspace_id) ?? null
		);
	}
	get todoFile() {
		return this.session.status === "ready" ? this.session.todo_file : null;
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
		if (this.isOperating) return;
		await this.restoration.mutateAsync();
	};
	private unavailable = async (): Promise<WorkspaceSessionActionResult> => ({
		status: "rejected",
		message: "This operation is not available yet in the Electron migration.",
	});
	create = async (
		input: DesktopRequest<"createWorkspace">
	): Promise<WorkspaceSessionActionResult> => {
		if (this.isOperating)
			return { status: "rejected", message: "A Workspace session operation is already running." };
		try {
			const outcome = await this.creation.mutateAsync(input);
			return outcome.status === "applied" ? { status: "applied" } : outcome;
		} catch (error) {
			return {
				status: "rejected",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	};
	open = async (workspaceId: string): Promise<WorkspaceSessionActionResult> => {
		if (this.isOperating)
			return { status: "rejected", message: "A Workspace session operation is already running." };
		try {
			const outcome = await this.switching.mutateAsync({ workspaceId });
			return outcome.status === "applied" ? { status: "applied" } : outcome;
		} catch (error) {
			return {
				status: "rejected",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	};
	deleteWorkspace = (_id: string) => this.unavailable();
	setCompletion = async (todo: TodoItem): Promise<WorkspaceSessionActionResult> => {
		if (this.isOperating)
			return { status: "rejected", message: "A Workspace session operation is already running." };
		const input = this.todoMutationTarget(todo);
		if (!input) return { status: "rejected", message: "No Active workspace Todo file is loaded." };
		try {
			const outcome = await this.completion.mutateAsync({ ...input, completed: !todo.completed });
			return outcome.status === "applied"
				? { status: "applied" }
				: { status: outcome.status, message: outcome.message };
		} catch (error) {
			return {
				status: "rejected",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	};
	private todoMutationTarget(todo: TodoItem): DesktopRequest<"deleteTodo"> | null {
		const confirmed = this.query.data;
		if (
			!confirmed ||
			confirmed.session.status !== "ready" ||
			!confirmed.session.catalogue.active_workspace_id
		)
			return null;
		return {
			scope: confirmed.scope,
			revision: confirmed.revision,
			workspaceId: confirmed.session.catalogue.active_workspace_id,
			lineNumber: todo.line_number,
			expectedRaw: todo.raw,
		};
	}
	deleteTodo = (_todo: TodoItem) => this.unavailable();
}
