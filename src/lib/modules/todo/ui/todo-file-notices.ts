import { toast } from "svelte-sonner";

/** Mutation compare-and-swap conflict: error toast after shared reload. */
export function showTodoFileConflictNotice() {
	toast.error("Todo file changed externally; reloaded latest version");
}

/**
 * Idle Todo-file observation: quieter info notice when the Todo-file summary changed.
 * Must never stack with {@link showTodoFileConflictNotice} for the same underlying change
 * (observation is busy-gated while mutations run).
 */
export function showTodoFileObservationNotice() {
	toast.info("Todo file updated from disk");
}
