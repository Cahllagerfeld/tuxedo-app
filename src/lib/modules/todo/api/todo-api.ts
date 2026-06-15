import { invoke } from "@tauri-apps/api/core";
import { parseTodoFileResponse, type TodoFile } from "$lib/modules/todo/domain/todo";

export async function parseTodoFile(path: string): Promise<TodoFile> {
	const response = await invoke("parse_todo_file", { path });
	return parseTodoFileResponse(response);
}

export async function appendTodoItem(root: string, raw: string): Promise<TodoFile> {
	const response = await invoke("append_todo_item", { root, raw });
	return parseTodoFileResponse(response);
}

export async function updateTodoItem(
	root: string,
	lineNumber: number,
	expectedRaw: string,
	raw: string
): Promise<TodoFile> {
	const response = await invoke("update_todo_item", {
		root,
		lineNumber,
		expectedRaw,
		raw,
	});
	return parseTodoFileResponse(response);
}

export async function toggleTodoItemCompleted(
	root: string,
	lineNumber: number,
	expectedRaw: string
): Promise<TodoFile> {
	const response = await invoke("toggle_todo_item_completed", {
		root,
		lineNumber,
		expectedRaw,
	});
	return parseTodoFileResponse(response);
}

export async function deleteTodoItem(
	root: string,
	lineNumber: number,
	expectedRaw: string
): Promise<TodoFile> {
	const response = await invoke("delete_todo_item", {
		root,
		lineNumber,
		expectedRaw,
	});
	return parseTodoFileResponse(response);
}
