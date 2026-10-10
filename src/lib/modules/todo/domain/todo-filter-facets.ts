import type { TodoItem } from "./todo";

/** Counts each exact facet once per item in the selected completion view. */
export function summarizeTodoFilterFacets(items: readonly TodoItem[], completed: boolean) {
	const projects = new Map<string, number>();
	const contexts = new Map<string, number>();
	const priorities = new Map<string, number>();
	for (const item of items) {
		if (item.completed !== completed) continue;
		for (const value of new Set(item.projects)) increment(projects, value);
		for (const value of new Set(item.contexts)) increment(contexts, value);
		if (!completed && item.priority !== null) increment(priorities, item.priority);
	}
	return {
		projects: sorted(projects),
		contexts: sorted(contexts),
		priorities: sorted(priorities),
		counts: { projects, contexts, priorities },
	};
}

function increment(counts: Map<string, number>, value: string) {
	counts.set(value, (counts.get(value) ?? 0) + 1);
}

function sorted(counts: ReadonlyMap<string, number>) {
	return [...counts.keys()].sort((left, right) => left.localeCompare(right));
}
