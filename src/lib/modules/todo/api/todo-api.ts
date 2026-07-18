import { invoke } from "@tauri-apps/api/core";

export type SetTodoItemCompletionInput = {
	lineNumber: number;
	expectedRaw: string;
	completed: boolean;
};

export async function setTodoItemCompletion(input: SetTodoItemCompletionInput): Promise<unknown> {
	return invoke("set_todo_item_completion", input);
}
