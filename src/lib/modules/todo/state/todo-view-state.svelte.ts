import type { TodoItem, SkippedLine } from "$lib/modules/todo/domain/todo";
import type { WorkspaceState } from "$lib/modules/workspace/state/workspace-state.svelte";

export class TodoViewState {
	constructor(workspace: WorkspaceState) {
		this.items = $derived(workspace.todoFile?.items ?? []);
		this.skipped = $derived(workspace.todoFile?.skipped ?? []);
		this.availableProjects = $derived.by(() =>
			uniqueSorted(this.items.flatMap((item) => item.projects))
		);
		this.availableContexts = $derived.by(() =>
			uniqueSorted(this.items.flatMap((item) => item.contexts))
		);
		this.availablePriorities = $derived.by(() =>
			uniqueSorted(this.items.flatMap((item) => (item.priority ? [item.priority] : [])))
		);
		this.totalCount = $derived(this.items.length);
		this.visibleCount = $derived(this.items.length);
		this.openCount = $derived(this.items.filter((item) => !item.completed).length);
		this.completedCount = $derived(this.items.filter((item) => item.completed).length);
		this.priorityCount = $derived(this.items.filter((item) => item.priority).length);
		this.projectCount = $derived(this.availableProjects.length);
	}

	items: TodoItem[];
	skipped: SkippedLine[];
	availableProjects: string[];
	availableContexts: string[];
	availablePriorities: string[];
	totalCount: number;
	visibleCount: number;
	openCount: number;
	completedCount: number;
	priorityCount: number;
	projectCount: number;
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
