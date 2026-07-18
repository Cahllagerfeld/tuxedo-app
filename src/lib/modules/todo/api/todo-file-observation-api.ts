import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TodoFileObservationAdapter } from "$lib/modules/todo/state/todo-file-observation";

export const TODO_FILE_CHANGED_EVENT = "todo-file-changed";

/**
 * Production Todo-file observation adapter: Rust watches the Active path and emits
 * {@link TODO_FILE_CHANGED_EVENT}; the frontend decides idle vs busy and reloads.
 */
export function createTodoFileObservationAdapter(): TodoFileObservationAdapter {
	let unlisten: UnlistenFn | null = null;
	let onChanged: (() => void | Promise<void>) | null = null;
	let isDisposed = false;

	async function ensureListener() {
		if (unlisten) return;
		const nextUnlisten = await listen(TODO_FILE_CHANGED_EVENT, () => {
			void onChanged?.();
		});
		if (isDisposed) {
			nextUnlisten();
			return;
		}
		unlisten = nextUnlisten;
	}

	return {
		async start(path, nextOnChanged) {
			if (isDisposed) return;
			onChanged = nextOnChanged;
			await ensureListener();
			if (isDisposed) return;
			await invoke("start_todo_file_observation", { path });
		},
		async stop() {
			await invoke("stop_todo_file_observation");
			onChanged = null;
		},
		async retarget(path) {
			if (path === null) {
				await invoke("stop_todo_file_observation");
				return;
			}
			await ensureListener();
			await invoke("start_todo_file_observation", { path });
		},
		async dispose() {
			isDisposed = true;
			onChanged = null;
			await invoke("stop_todo_file_observation");
			unlisten?.();
			unlisten = null;
		},
	};
}
