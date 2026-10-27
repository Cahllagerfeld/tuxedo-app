import type { DesktopAPI, DesktopRequest } from "@tuxedo/contracts";
import type { TodoItem } from "#lib/modules/todo/domain/todo.js";
import type { CreateTodoDraft, WorkspaceCommandContext } from "./workspace-commands.svelte";
import type { WorkspaceSessionActionResult } from "./workspace-session-types";
import { CommandValidationError } from "./workspace-command-gate.svelte";

export function todoCommands({ desktop, gate, reader }: WorkspaceCommandContext) {
	async function todoOutcome(
		outcome: Awaited<ReturnType<DesktopAPI["deleteTodo"]>>
	): Promise<WorkspaceSessionActionResult> {
		if (outcome.status === "rejected") return outcome;
		reader.requireRevision(outcome.confirmed);
		const refreshed = await reader.refresh({ workspaceId: outcome.confirmed.workspaceId });
		if (outcome.status === "conflict") return { status: "conflict", message: outcome.message };
		return {
			status: "applied",
			...(refreshed.status === "rejected"
				? { notice: "Change saved, but the Workspace could not be refreshed. " + refreshed.message }
				: outcome.notice
					? { notice: outcome.notice }
					: {}),
		};
	}
	function validateCurrentItems(items: readonly TodoItem[]) {
		const current = new Map(reader.todoFile?.items.map((item) => [item.line_number, item.raw]));
		if (items.some((item) => current.get(item.line_number) !== item.raw))
			throw new CommandValidationError(
				"The Todo file changed. Try again with its current Todo items."
			);
	}
	function todoMutationTarget(todo: TodoItem): DesktopRequest<"deleteTodo"> {
		return { ...reader.todoTarget(), lineNumber: todo.line_number, expectedRaw: todo.raw };
	}
	const targets = (items: readonly TodoItem[]) =>
		items.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw }));

	return {
		undoTodo: () =>
			gate.run(
				"undo_todo_change",
				async () => todoOutcome(await desktop.undoTodo(reader.todoTarget())),
				{ target: reader.todoOperationTarget() }
			),
		setCompletion: (todo: TodoItem) =>
			gate.run(
				"set_todo_item_completion",
				async () => {
					const input = todoMutationTarget(todo);
					return todoOutcome(
						await desktop.setTodoCompletion({ ...input, completed: !todo.completed })
					);
				},
				{ target: reader.todoOperationTarget(todo) }
			),
		bulkSetCompletion: (items: readonly TodoItem[], completed: boolean) =>
			gate.run(
				"bulk_set_todo_item_completion",
				async () => {
					const target = reader.todoTarget();
					validateCurrentItems(items);
					return todoOutcome(
						await desktop.bulkSetTodoCompletion({ ...target, completed, targets: targets(items) })
					);
				},
				{ target: reader.todoOperationTarget() }
			),
		bulkDeleteTodos: (items: readonly TodoItem[]) =>
			gate.run(
				"bulk_delete_todo_items",
				async () => {
					const target = reader.todoTarget();
					validateCurrentItems(items);
					return todoOutcome(await desktop.bulkDeleteTodos({ ...target, targets: targets(items) }));
				},
				{ target: reader.todoOperationTarget() }
			),
		editTodo: (todo: TodoItem, draft: CreateTodoDraft) =>
			gate.run(
				"edit_todo_item",
				async () => {
					const target = todoMutationTarget(todo);
					return todoOutcome(
						await desktop.editTodo({
							...draft,
							...target,
							creationDate: draft.creationDate ?? null,
							completed: draft.completed ?? todo.completed,
						})
					);
				},
				{ target: reader.todoOperationTarget(todo) }
			),
		deleteTodo: (todo: TodoItem) =>
			gate.run(
				"delete_todo_item",
				async () => todoOutcome(await desktop.deleteTodo(todoMutationTarget(todo))),
				{ target: reader.todoOperationTarget(todo) }
			),
		reorderTodo: (items: readonly TodoItem[]) =>
			gate.run(
				"reorder_todo_items",
				async () => {
					const target = reader.todoTarget();
					validateCurrentItems(items);
					return todoOutcome(
						await desktop.reorderTodo({
							...target,
							lineNumbers: items.map((item) => item.line_number),
						})
					);
				},
				{ target: reader.todoOperationTarget() }
			),
		createTodo: (draft: CreateTodoDraft) =>
			gate.run(
				"create_todo_item",
				async () => {
					const target = reader.todoTarget();
					return todoOutcome(await desktop.createTodo({ ...target, ...draft }));
				},
				{ target: reader.todoOperationTarget() }
			),
	};
}
