import type { TodoItem } from "$lib/modules/todo/domain/todo";
import type { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";
import { toast } from "svelte-sonner";

// Live input getters follow the controller supplied by app composition.
export function createWorkspaceTodoActions(
	inputs: Readonly<{ workspace: ElectronWorkspaceSessionState }>
) {
	async function toggleTodoCompletion(todo: TodoItem) {
		try {
			const result = await inputs.workspace.setCompletion(todo);
			if (result.status === "conflict") {
				toast.error("Todo file changed externally; reloaded latest version");
			} else if (result.status === "rejected") {
				toast.error("Could not update Todo item", { description: result.message });
			}
			return result.status === "applied";
		} catch (error) {
			toast.error("Could not update Todo item", {
				description: errorMessage(error),
			});
			return false;
		}
	}

	async function deleteTodoItem(todo: TodoItem) {
		try {
			const result = await inputs.workspace.deleteTodo(todo);
			if (result.status === "conflict") {
				toast.error("Todo file changed externally; reloaded latest version");
			} else if (result.status === "rejected") {
				toast.error("Could not delete Todo item", { description: result.message });
			}
			return result.status === "applied";
		} catch (error) {
			toast.error("Could not delete Todo item", {
				description: errorMessage(error),
			});
			return false;
		}
	}

	function errorMessage(error: unknown) {
		if (error instanceof Error) return error.message;
		if (
			typeof error === "object" &&
			error !== null &&
			"message" in error &&
			typeof error.message === "string"
		) {
			return error.message;
		}
		return String(error);
	}
	return { toggleCompletion: toggleTodoCompletion, deleteItem: deleteTodoItem };
}
