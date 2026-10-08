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
} from "./workspace-session-types";
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
	private readonly todoDeletion;
	private readonly deletion;
	// Admission must be synchronous; Query observer notifications are batched.
	private operationAdmitted = $state(false);
	private applySessionOutcome = (outcome: Awaited<ReturnType<DesktopAPI["createWorkspace"]>>) => {
		if (outcome.status === "applied")
			this.client.setQueryData<ConfirmedSession>(sessionKey, (previous) =>
				reconcileConfirmedSession(previous, outcome.confirmed)
			);
	};
	private applyTodoOutcome = (outcome: Awaited<ReturnType<DesktopAPI["deleteTodo"]>>) => {
		if (outcome.status !== "rejected")
			this.client.setQueryData<ConfirmedSession>(sessionKey, (previous) =>
				reconcileConfirmedTodo(previous, outcome.confirmed)
			);
	};
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
				onSuccess: this.applySessionOutcome,
			}),
			() => this.client
		);
		this.switching = createMutation(
			() => ({
				mutationFn: (input: DesktopRequest<"switchWorkspace">) => desktop.switchWorkspace(input),
				onSuccess: this.applySessionOutcome,
			}),
			() => this.client
		);
		this.deletion = createMutation(
			() => ({
				mutationFn: (input: DesktopRequest<"deleteWorkspace">) => desktop.deleteWorkspace(input),
				onSuccess: this.applySessionOutcome,
			}),
			() => this.client
		);
		this.completion = createMutation(
			() => ({
				mutationFn: (input: DesktopRequest<"setTodoCompletion">) =>
					desktop.setTodoCompletion(input),
				onSuccess: this.applyTodoOutcome,
			}),
			() => this.client
		);
		this.todoDeletion = createMutation(
			() => ({
				mutationFn: (input: DesktopRequest<"deleteTodo">) => desktop.deleteTodo(input),
				onSuccess: this.applyTodoOutcome,
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
					: this.deletion.isPending
						? "delete_workspace"
						: this.completion.isPending
							? "set_todo_item_completion"
							: this.todoDeletion.isPending
								? "delete_todo_item"
								: null;
	}
	get isOperating() {
		return (
			this.operationAdmitted ||
			this.restoration.isPending ||
			this.creation.isPending ||
			this.switching.isPending ||
			this.completion.isPending ||
			this.deletion.isPending ||
			this.todoDeletion.isPending
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
	private async runAction(
		action: () => Promise<WorkspaceSessionActionResult>
	): Promise<WorkspaceSessionActionResult> {
		if (this.isOperating)
			return { status: "rejected", message: "A Workspace session operation is already running." };
		this.operationAdmitted = true;
		try {
			const outcome = await action();
			return outcome.status === "applied"
				? { status: "applied" }
				: { status: outcome.status, message: outcome.message };
		} catch (error) {
			return {
				status: "rejected",
				message: error instanceof Error ? error.message : String(error),
			};
		} finally {
			this.operationAdmitted = false;
		}
	}
	restore = () =>
		this.runAction(async () => {
			await this.restoration.mutateAsync();
			return { status: "applied" };
		});
	create = (input: DesktopRequest<"createWorkspace">) =>
		this.runAction(() => this.creation.mutateAsync(input));
	open = (workspaceId: string) => this.runAction(() => this.switching.mutateAsync({ workspaceId }));
	deleteWorkspace = (workspaceId: string) =>
		this.runAction(() => this.deletion.mutateAsync({ workspaceId }));
	setCompletion = (todo: TodoItem) =>
		this.runAction(async () => {
			const input = this.todoMutationTarget(todo);
			if (!input)
				return { status: "rejected", message: "No Active workspace Todo file is loaded." };
			return this.completion.mutateAsync({ ...input, completed: !todo.completed });
		});
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
	deleteTodo = (todo: TodoItem) =>
		this.runAction(async () => {
			const input = this.todoMutationTarget(todo);
			if (!input)
				return { status: "rejected", message: "No Active workspace Todo file is loaded." };
			return this.todoDeletion.mutateAsync(input);
		});
}
