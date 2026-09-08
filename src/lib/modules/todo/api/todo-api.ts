import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceSessionOperationOutcome } from "$lib/modules/workspace/domain/workspace";

export type SetTodoItemCompletionInput = {
	lineNumber: number;
	expectedRaw: string;
	completed: boolean;
};

export type DeleteTodoItemInput = {
	lineNumber: number;
	expectedRaw: string;
};

export async function setTodoItemCompletion(
	input: SetTodoItemCompletionInput
): Promise<WorkspaceSessionOperationOutcome> {
	return invoke<WorkspaceSessionOperationOutcome>("set_todo_item_completion", input);
}

export async function deleteTodoItem(
	input: DeleteTodoItemInput
): Promise<WorkspaceSessionOperationOutcome> {
	return invoke<WorkspaceSessionOperationOutcome>("delete_todo_item", input);
}
