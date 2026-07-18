import { invoke } from "@tauri-apps/api/core";

export type SetTodoItemCompletionInput = {
	lineNumber: number;
	expectedRaw: string;
	completed: boolean;
};

export type DeleteTodoItemInput = {
	lineNumber: number;
	expectedRaw: string;
};

export async function setTodoItemCompletion(input: SetTodoItemCompletionInput): Promise<unknown> {
	return invoke("set_todo_item_completion", input);
}

export async function deleteTodoItem(input: DeleteTodoItemInput): Promise<unknown> {
	return invoke("delete_todo_item", input);
}
