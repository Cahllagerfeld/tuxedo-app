import type { TodoItem } from "../../domain/todo";
import type { TodoSortOrder } from "@tuxedo/contracts";
import { TodoFilterState } from "../todo-filter.svelte";

export function filterFixture() {
	let items = $state.raw<readonly TodoItem[]>([]);
	const filter = new TodoFilterState(() => items);
	return {
		filter,
		publish: (
			workspaceId: string,
			next: readonly TodoItem[],
			sortOrder?: TodoSortOrder,
			showDeferred?: boolean
		) => {
			items = next;
			filter.sync(workspaceId, sortOrder, showDeferred);
		},
	};
}
