import type { DesktopAPI, DesktopRequest } from "@tuxedo/contracts";
import type { BoardColumn } from "@tuxedo/contracts/board";
import type { TodoItem } from "#lib/modules/todo/domain/todo.js";
import type { CreateTodoDraft, WorkspaceCommandContext } from "./workspace-commands.svelte";
import type {
	WorkspaceSessionActionResult,
	WorkspaceSessionOperation,
} from "./workspace-session-types";
import { CommandValidationError } from "./workspace-command-gate.svelte";

type TodoTarget = DesktopRequest<"undoTodo">;
type TodoOutcome = Awaited<ReturnType<DesktopAPI["undoTodo"]>>;

export function todoCommands({ desktop, gate, reader }: WorkspaceCommandContext) {
	function mutate(
		operation: WorkspaceSessionOperation,
		send: (target: TodoTarget) => Promise<TodoOutcome>,
		todo?: TodoItem
	) {
		return gate.run(
			operation,
			async (): Promise<WorkspaceSessionActionResult> => {
				const target = reader.todoTarget();
				const outcome = await send(target);
				if (outcome.status === "rejected") return outcome;
				const refreshed = await reader.refresh({ workspaceId: target.workspaceId });
				if (outcome.status === "conflict") return { status: "conflict", message: outcome.message };
				return {
					status: "applied",
					...(refreshed.status === "rejected"
						? {
								notice:
									"Change saved, but the Workspace could not be refreshed. " + refreshed.message,
							}
						: outcome.notice
							? { notice: outcome.notice }
							: {}),
				};
			},
			{ target: reader.todoOperationTarget(todo) }
		);
	}
	function validateCurrentItems(items: readonly TodoItem[]) {
		const current = new Map(reader.todoFile?.items.map((item) => [item.line_number, item.raw]));
		if (items.some((item) => current.get(item.line_number) !== item.raw))
			throw new CommandValidationError(
				"The Todo file changed. Try again with its current Todo items."
			);
	}
	const line = (todo: TodoItem) => ({ lineNumber: todo.line_number, expectedRaw: todo.raw });

	return {
		undoTodo: () => mutate("undo_todo_change", (target) => desktop.undoTodo(target)),
		setCompletion: (todo: TodoItem) =>
			mutate(
				"set_todo_item_completion",
				(target) =>
					desktop.setTodoCompletion({ ...target, ...line(todo), completed: !todo.completed }),
				todo
			),
		bulkSetCompletion: (items: readonly TodoItem[], completed: boolean) =>
			mutate("bulk_set_todo_item_completion", (target) => {
				validateCurrentItems(items);
				return desktop.bulkSetTodoCompletion({ ...target, completed, targets: items.map(line) });
			}),
		bulkDeleteTodos: (items: readonly TodoItem[]) =>
			mutate("bulk_delete_todo_items", (target) => {
				validateCurrentItems(items);
				return desktop.bulkDeleteTodos({ ...target, targets: items.map(line) });
			}),
		editTodo: (todo: TodoItem, draft: CreateTodoDraft) =>
			mutate(
				"edit_todo_item",
				(target) =>
					desktop.editTodo({
						...draft,
						...target,
						...line(todo),
						creationDate: draft.creationDate ?? null,
						completed: draft.completed ?? todo.completed,
					}),
				todo
			),
		deleteTodo: (todo: TodoItem) =>
			mutate(
				"delete_todo_item",
				(target) => desktop.deleteTodo({ ...target, ...line(todo) }),
				todo
			),
		reorderTodo: (items: readonly TodoItem[]) =>
			mutate("reorder_todo_items", (target) => {
				validateCurrentItems(items);
				return desktop.reorderTodo({
					...target,
					lineNumbers: items.map((item) => item.line_number),
				});
			}),
		moveTodoOnBoard: (todo: TodoItem, column: BoardColumn) =>
			mutate(
				"move_todo_on_board",
				(target) => desktop.moveTodoOnBoard({ ...target, ...line(todo), column }),
				todo
			),
		createTodo: (draft: CreateTodoDraft) =>
			mutate("create_todo_item", (target) => desktop.createTodo({ ...target, ...draft })),
	};
}
