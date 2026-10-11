import type { SkippedLine, TodoFile, TodoItem } from "./todo";

export type TodoFileSummary = Readonly<{
	items: readonly TodoItem[];
	skipped: readonly SkippedLine[];
	counts: Readonly<{
		total: number;
		open: number;
		completed: number;
		skipped: number;
	}>;
}>;

export function summarizeTodoFile(todoFile: TodoFile | null): TodoFileSummary {
	const items: readonly TodoItem[] = todoFile?.items ?? [];
	const skipped: readonly SkippedLine[] = todoFile?.skipped ?? [];
	const completed = items.filter((item) => item.completed).length;

	return {
		items,
		skipped,
		counts: {
			total: items.length,
			open: items.length - completed,
			completed,
			skipped: skipped.length,
		},
	} as const;
}
