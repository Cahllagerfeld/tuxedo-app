import {
	setTodoItemCompletion,
	type SetTodoItemCompletionInput,
} from "$lib/modules/todo/api/todo-api";
import { parseTodoFileResponse, type TodoFile, type TodoItem } from "../domain/todo";

export interface TodoFileSession {
	replaceTodoFile(todoFile: TodoFile): void;
	refreshTodoFile(): Promise<void>;
}

export interface TodoMutationAdapter {
	setTodoItemCompletion(input: SetTodoItemCompletionInput): Promise<unknown>;
}

const tauriTodoMutationAdapter: TodoMutationAdapter = { setTodoItemCompletion };

export class TodoState {
	isMutationPending = $state(false);

	constructor(
		private readonly session: TodoFileSession,
		private readonly adapter: TodoMutationAdapter = tauriTodoMutationAdapter
	) {}

	setCompletion = async (todo: TodoItem): Promise<"updated" | "conflict"> => {
		if (this.isMutationPending) throw new Error("A Todo-file mutation is already running");
		this.isMutationPending = true;
		try {
			const todoFile = parseTodoFileResponse(
				await this.adapter.setTodoItemCompletion({
					lineNumber: todo.line_number,
					expectedRaw: todo.raw,
					completed: !todo.completed,
				})
			);
			this.session.replaceTodoFile(todoFile);
			await this.session.refreshTodoFile();
			return "updated";
		} catch (error) {
			if (isTodoMutationConflict(error)) {
				await this.session.refreshTodoFile();
				return "conflict";
			}
			throw error;
		} finally {
			this.isMutationPending = false;
		}
	};
}

function isTodoMutationConflict(error: unknown): boolean {
	return (
		typeof error === "object" && error !== null && "kind" in error && error.kind === "conflict"
	);
}
