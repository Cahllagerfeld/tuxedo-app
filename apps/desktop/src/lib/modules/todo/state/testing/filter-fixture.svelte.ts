import type { TodoItem } from "../../domain/todo";
import type { TodoSortOrder } from "@tuxedo/contracts";
import { TodoFilterState } from "../todo-filter.svelte";

export function filterFixture() {
	let items = $state.raw<readonly TodoItem[]>([]);
	let preferences = $state.raw<{ sort_order?: TodoSortOrder; show_deferred?: boolean }>({});
	let currentWorkspace: string | undefined;
	const filter = new TodoFilterState(
		() => items,
		() => preferences
	);
	return {
		filter,
		setPreferences: (next: typeof preferences) => {
			preferences = { ...preferences, ...next };
		},
		publish: (
			workspaceId: string,
			next: readonly TodoItem[],
			sortOrder?: TodoSortOrder,
			showDeferred?: boolean
		) => {
			items = next;
			if (currentWorkspace !== workspaceId) preferences = {};
			currentWorkspace = workspaceId;
			preferences = {
				...preferences,
				...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
				...(showDeferred !== undefined ? { show_deferred: showDeferred } : {}),
			};
			filter.sync(workspaceId);
		},
	};
}
