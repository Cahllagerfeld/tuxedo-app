import type { SkippedLine, TodoFile, TodoItem } from "./todo";

export type TodoFileSummary = Readonly<{
	items: readonly TodoItem[];
	skipped: readonly SkippedLine[];
	counts: Readonly<{
		total: number;
		open: number;
		completed: number;
		priority: number;
		projects: number;
		skipped: number;
	}>;
	facets: Readonly<{
		projects: readonly string[];
		contexts: readonly string[];
		priorities: readonly string[];
	}>;
}>;

export function summarizeTodoFile(todoFile: TodoFile | null): TodoFileSummary {
	const items: readonly TodoItem[] = todoFile?.items ?? [];
	const skipped: readonly SkippedLine[] = todoFile?.skipped ?? [];
	let open = 0;
	let completed = 0;
	let priority = 0;
	const projects = new Set<string>();
	const contexts = new Set<string>();
	const priorities = new Set<string>();

	for (const item of items) {
		for (const project of item.projects) projects.add(project);
		for (const context of item.contexts) contexts.add(context);

		if (item.completed) {
			completed += 1;
			continue;
		}

		open += 1;
		if (isPriority(item.priority)) {
			priority += 1;
			priorities.add(item.priority);
		}
	}

	return {
		items,
		skipped,
		counts: {
			total: items.length,
			open,
			completed,
			priority,
			projects: projects.size,
			skipped: skipped.length,
		},
		facets: {
			projects: sorted(projects),
			contexts: sorted(contexts),
			priorities: sorted(priorities),
		},
	} as const;
}

function sorted(values: ReadonlySet<string>): readonly string[] {
	return [...values].sort((left, right) => left.localeCompare(right));
}

function isPriority(value: string | null): value is string {
	return value !== null && /^[A-Z]$/.test(value);
}
