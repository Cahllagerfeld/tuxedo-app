import {
	createTodoItem,
	deleteTodoItem,
	setTodoItemCompletion,
	type CreateTodoItemInput,
	type DeleteTodoItemInput,
	type SetTodoItemCompletionInput,
} from "$lib/modules/todo/api/todo-api";
import { parseTodoFileResponse, type TodoFile, type TodoItem } from "../domain/todo";

export interface TodoFileSession {
	replaceTodoFile(todoFile: TodoFile): void;
	refreshTodoFile(): Promise<void>;
}

export interface TodoMutationAdapter {
	setTodoItemCompletion(input: SetTodoItemCompletionInput): Promise<unknown>;
	deleteTodoItem(input: DeleteTodoItemInput): Promise<unknown>;
	createTodoItem(input: CreateTodoItemInput): Promise<unknown>;
}

const tauriTodoMutationAdapter: TodoMutationAdapter = {
	setTodoItemCompletion,
	deleteTodoItem,
	createTodoItem,
};

export class TodoState {
	isMutationPending = $state(false);

	constructor(
		private readonly session: TodoFileSession,
		private readonly adapter: TodoMutationAdapter = tauriTodoMutationAdapter
	) {}

	setCompletion = async (todo: TodoItem): Promise<"updated" | "conflict"> => {
		return this.runMutation(() =>
			this.adapter.setTodoItemCompletion({
				lineNumber: todo.line_number,
				expectedRaw: todo.raw,
				completed: !todo.completed,
			})
		);
	};

	delete = async (todo: TodoItem): Promise<"updated" | "conflict"> => {
		return this.runMutation(() =>
			this.adapter.deleteTodoItem({
				lineNumber: todo.line_number,
				expectedRaw: todo.raw,
			})
		);
	};

	create = async (input: CreateTodoItemInput): Promise<"updated" | "conflict"> => {
		return this.runMutation(() => this.adapter.createTodoItem(input));
	};

	private runMutation = async (mutate: () => Promise<unknown>): Promise<"updated" | "conflict"> => {
		if (this.isMutationPending) throw new Error("A Todo-file mutation is already running");
		this.isMutationPending = true;
		try {
			const todoFile = parseTodoFileResponse(await mutate());
			this.session.replaceTodoFile(todoFile);
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
