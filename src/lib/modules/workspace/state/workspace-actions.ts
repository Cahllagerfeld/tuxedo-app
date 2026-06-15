import { parseTodoFile, toggleTodoItemCompleted } from "$lib/modules/todo/api/todo-api";
import {
	chooseWorkspaceDirectory,
	loadWorkspaceConfig,
	resolveWorkspaceTodo,
	saveWorkspaceConfig,
} from "$lib/modules/workspace/api/workspace-api";
import type { WorkspaceStore } from "./workspace-store.svelte";

function formatUnknownError(unknownError: unknown): string {
	return unknownError instanceof Error ? unknownError.message : String(unknownError);
}

function missingTodoWarning(root: string): string {
	return `No todo.txt file was found in ${root}. Add one there or choose another directory.`;
}

export async function restoreWorkspace(store: WorkspaceStore) {
	store.error = "";
	store.warning = "";
	store.isLoading = true;

	try {
		const config = await loadWorkspaceConfig();
		store.root = config.root;

		if (!config.root) {
			store.clear();
			return;
		}

		await loadWorkspaceRoot(store, config.root);
	} catch (unknownError) {
		store.error = formatUnknownError(unknownError);
		store.todoPath = null;
		store.todoFile = null;
	} finally {
		store.isLoading = false;
	}
}

export async function openWorkspaceDirectory(store: WorkspaceStore) {
	store.error = "";
	store.warning = "";
	store.isLoading = true;

	try {
		const root = await chooseWorkspaceDirectory();

		if (!root) {
			return;
		}

		const config = await saveWorkspaceConfig(root);

		if (config.root) {
			await loadWorkspaceRoot(store, config.root);
		}
	} catch (unknownError) {
		store.error = formatUnknownError(unknownError);
	} finally {
		store.isLoading = false;
	}
}

export async function loadWorkspaceRoot(store: WorkspaceStore, root: string) {
	const resolution = await resolveWorkspaceTodo(root);

	store.root = resolution.root;
	store.todoPath = resolution.todo_path;
	store.todoExists = resolution.todo_exists;

	if (resolution.todo_exists) {
		store.todoFile = await parseTodoFile(resolution.todo_path);
		store.warning = "";
	} else {
		store.todoFile = null;
		store.warning = missingTodoWarning(resolution.root);
	}
}

export async function toggleTodoItem(
	store: WorkspaceStore,
	lineNumber: number,
	expectedRaw: string
) {
	if (!store.root) {
		store.error = "No workspace is open.";
		return;
	}

	store.error = "";

	try {
		store.todoFile = await toggleTodoItemCompleted(store.root, lineNumber, expectedRaw);
	} catch (unknownError) {
		store.error = formatUnknownError(unknownError);
	}
}
