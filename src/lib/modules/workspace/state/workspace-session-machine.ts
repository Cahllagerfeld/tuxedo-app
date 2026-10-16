import { assign, fromPromise, setup } from "xstate";
import {
	confirmedSessionSchema,
	confirmedTodoSchema,
	type ConfirmedSession,
	type ConfirmedTodo,
	type DesktopAPI,
	type DesktopRequest,
	type SavedView,
	type SavedViewFilterValues,
	type TodoSortOrder,
} from "$lib/shared/desktop/contract";
import type { TodoItem } from "$lib/modules/todo/domain/todo";
import type {
	WorkspaceSessionActionResult,
	WorkspaceSessionOperationTarget,
} from "./workspace-session-types";

type CreateTodoRequest = DesktopRequest<"createTodo">;
export type CreateTodoDraft = Omit<CreateTodoRequest, "scope" | "revision" | "workspaceId">;

export type WorkspaceSessionCommand =
	| { operation: "restore" }
	| { operation: "create_workspace"; input: DesktopRequest<"createWorkspace"> }
	| { operation: "open_workspace" | "delete_workspace"; workspaceId: string }
	| { operation: "set_workspace_sort_order"; sortOrder: TodoSortOrder }
	| { operation: "set_workspace_show_deferred"; showDeferred: boolean }
	| { operation: "undo_todo_change" }
	| { operation: "save_view"; name: string; filters: SavedViewFilterValues }
	| { operation: "delete_view"; viewId: string }
	| { operation: "set_todo_item_completion"; todo: TodoItem }
	| { operation: "delete_todo_item"; todo: TodoItem }
	| { operation: "edit_todo_item"; todo: TodoItem; draft: CreateTodoDraft }
	| { operation: "create_todo_item"; draft: CreateTodoDraft }
	| { operation: "reorder_todo_items"; items: readonly TodoItem[] };

type Request = {
	command: WorkspaceSessionCommand;
	reply: (outcome: WorkspaceSessionActionResult) => void;
};

type SessionData = {
	confirmed: ConfirmedSession | undefined;
	readError: string | null;
	savedViews: readonly SavedView[];
	savedViewsError: string;
};

type Context = SessionData & {
	desktop: DesktopAPI;
	request: Request | null;
	target: WorkspaceSessionOperationTarget | null;
};

type Result = Partial<SessionData> & { outcome: WorkspaceSessionActionResult };
type Event =
	| { type: "REQUEST"; request: Request }
	| { type: "RESTORED"; confirmed: ConfirmedSession }
	| { type: "STARTUP_FAILED"; message: string };

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
		undoLabel: parsed.undoLabel,
		session: { ...previous.session, todo_file: parsed.todo_file },
	};
}

function operationTarget(
	command: WorkspaceSessionCommand,
	confirmed: ConfirmedSession | undefined
): WorkspaceSessionOperationTarget | null {
	if (command.operation === "restore") return null;
	if (command.operation === "create_workspace") return { todoPath: command.input.todoPath };
	if ("workspaceId" in command) return { workspaceId: command.workspaceId };
	const session = confirmed?.session;
	const workspaceId =
		session?.status === "ready" || session?.status === "empty"
			? session.catalogue.active_workspace_id
			: null;
	return workspaceId
		? { workspaceId, ...("todo" in command ? { lineNumber: command.todo.line_number } : {}) }
		: null;
}

function todoTarget(confirmed: ConfirmedSession | undefined) {
	if (
		!confirmed ||
		confirmed.session.status !== "ready" ||
		!confirmed.session.catalogue.active_workspace_id
	)
		throw Error("No Active workspace Todo file is loaded.");
	return {
		scope: confirmed.scope,
		revision: confirmed.revision,
		workspaceId: confirmed.session.catalogue.active_workspace_id,
	};
}

function publicOutcome(outcome: WorkspaceSessionActionResult): WorkspaceSessionActionResult {
	return outcome.status === "applied"
		? { status: "applied", ...(outcome.notice ? { notice: outcome.notice } : {}) }
		: { status: outcome.status, message: outcome.message };
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

async function execute({
	desktop,
	confirmed,
	command,
	restored,
}: {
	desktop: DesktopAPI;
	confirmed: ConfirmedSession | undefined;
	command: WorkspaceSessionCommand;
	restored: (confirmed: ConfirmedSession) => void;
}): Promise<Result> {
	const sessionOutcome = (outcome: Awaited<ReturnType<DesktopAPI["createWorkspace"]>>): Result =>
		outcome.status === "applied"
			? {
					confirmed: reconcileConfirmedSession(confirmed, outcome.confirmed),
					readError: null,
					outcome: publicOutcome(outcome),
				}
			: { outcome: publicOutcome(outcome) };
	const todoOutcome = (outcome: Awaited<ReturnType<DesktopAPI["deleteTodo"]>>): Result =>
		outcome.status === "rejected"
			? { outcome: publicOutcome(outcome) }
			: {
					confirmed: reconcileConfirmedTodo(confirmed, outcome.confirmed),
					outcome: publicOutcome(outcome),
				};

	switch (command.operation) {
		case "restore": {
			// Keep restored contents visible while the separate Saved-view read is pending.
			restored(reconcileConfirmedSession(confirmed, await desktop.restoreSession({})));
			try {
				const views = await desktop.readSavedViews({});
				return {
					outcome: { status: "applied" },
					...(views.status === "applied"
						? { savedViews: views.views, savedViewsError: "" }
						: { savedViewsError: views.message }),
				};
			} catch (error) {
				return { outcome: { status: "applied" }, savedViewsError: errorMessage(error) };
			}
		}
		case "create_workspace":
			return sessionOutcome(await desktop.createWorkspace(command.input));
		case "open_workspace":
			return sessionOutcome(await desktop.switchWorkspace({ workspaceId: command.workspaceId }));
		case "delete_workspace":
			return sessionOutcome(await desktop.deleteWorkspace({ workspaceId: command.workspaceId }));
		case "set_workspace_sort_order":
			return sessionOutcome(
				await desktop.setWorkspaceSortOrder({
					...todoTarget(confirmed),
					sortOrder: command.sortOrder,
				})
			);
		case "set_workspace_show_deferred":
			return sessionOutcome(
				await desktop.setWorkspaceShowDeferred({
					...todoTarget(confirmed),
					showDeferred: command.showDeferred,
				})
			);
		case "save_view":
		case "delete_view": {
			const session = confirmed?.session;
			const workspaceId =
				session?.status === "ready" || session?.status === "empty"
					? session.catalogue.active_workspace_id
					: null;
			if (!workspaceId)
				return { outcome: { status: "rejected", message: "Open a Workspace first." } };
			const outcome =
				command.operation === "save_view"
					? await desktop.saveView({ workspaceId, name: command.name, filters: command.filters })
					: await desktop.deleteView({ workspaceId, viewId: command.viewId });
			return {
				outcome: publicOutcome(outcome),
				...(outcome.status === "applied" ? { savedViews: outcome.views, savedViewsError: "" } : {}),
			};
		}
		case "undo_todo_change":
			return todoOutcome(await desktop.undoTodo(todoTarget(confirmed)));
		case "create_todo_item":
			return todoOutcome(await desktop.createTodo({ ...todoTarget(confirmed), ...command.draft }));
		case "reorder_todo_items": {
			const target = todoTarget(confirmed);
			const current = new Map(
				confirmed?.session.status === "ready"
					? confirmed.session.todo_file.items.map((item) => [item.line_number, item.raw])
					: []
			);
			if (command.items.some((item) => current.get(item.line_number) !== item.raw))
				return {
					outcome: {
						status: "rejected",
						message: "The Todo file changed. Try again with its current Todo items.",
					},
				};
			return todoOutcome(
				await desktop.reorderTodo({
					...target,
					lineNumbers: command.items.map((item) => item.line_number),
				})
			);
		}
		case "set_todo_item_completion":
		case "delete_todo_item":
		case "edit_todo_item": {
			const target = {
				...todoTarget(confirmed),
				lineNumber: command.todo.line_number,
				expectedRaw: command.todo.raw,
			};
			if (command.operation === "delete_todo_item")
				return todoOutcome(await desktop.deleteTodo(target));
			if (command.operation === "set_todo_item_completion")
				return todoOutcome(
					await desktop.setTodoCompletion({ ...target, completed: !command.todo.completed })
				);
			return todoOutcome(
				await desktop.editTodo({
					...command.draft,
					...target,
					creationDate: command.draft.creationDate ?? null,
					completed: command.draft.completed ?? command.todo.completed,
				})
			);
		}
	}
}

export const workspaceSessionMachine = setup({
	types: {
		context: {} as Context,
		input: {} as { desktop: DesktopAPI },
		events: {} as Event,
	},
	actors: {
		execute: fromPromise<Result, Parameters<typeof execute>[0]>(({ input }) => execute(input)),
	},
}).createMachine({
	id: "workspaceSession",
	initial: "idle",
	context: ({ input }) => ({
		desktop: input.desktop,
		confirmed: undefined,
		readError: null,
		savedViews: [],
		savedViewsError: "",
		request: null,
		target: null,
	}),
	on: {
		STARTUP_FAILED: {
			actions: assign({
				readError: ({ context, event }) => (context.confirmed ? context.readError : event.message),
			}),
		},
	},
	states: {
		idle: {
			on: {
				REQUEST: {
					target: "running",
					actions: assign({
						request: ({ event }) => event.request,
						target: ({ context, event }) =>
							operationTarget(event.request.command, context.confirmed),
					}),
				},
			},
		},
		running: {
			on: {
				REQUEST: {
					actions: ({ event }) =>
						event.request.reply({
							status: "rejected",
							message: "A Workspace session operation is already running.",
						}),
				},
				RESTORED: {
					actions: assign({ confirmed: ({ event }) => event.confirmed, readError: null }),
				},
			},
			invoke: {
				src: "execute",
				input: ({ context, self }) => {
					if (!context.request) throw Error("Missing Workspace session request.");
					return {
						desktop: context.desktop,
						confirmed: context.confirmed,
						command: context.request.command,
						restored: (confirmed) => self.send({ type: "RESTORED", confirmed }),
					};
				},
				onDone: {
					target: "idle",
					actions: [
						assign(({ event }) => {
							const { outcome: _, ...data } = event.output;
							return data;
						}),
						({ context, event }) => context.request?.reply(event.output.outcome),
						assign({ request: null, target: null }),
					],
				},
				onError: {
					target: "idle",
					actions: [
						({ context, event }) =>
							context.request?.reply({ status: "rejected", message: errorMessage(event.error) }),
						assign({ request: null, target: null }),
					],
				},
			},
		},
	},
});
