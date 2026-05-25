import type { TodoItem, SkippedLine } from "$lib/todo";
import type { TodoFilterState } from "./filter-state.svelte";
import type { WorkspaceState } from "./workspace-state.svelte";

export class TodoViewState {
	constructor(workspace: WorkspaceState, filters: TodoFilterState) {
		this.items = $derived(workspace.todoFile?.items ?? []);
		this.skipped = $derived(workspace.todoFile?.skipped ?? []);
		this.filteredItems = $derived.by(() => filters.filterItems(this.items));
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
		this.visibleCount = $derived(this.filteredItems.length);
		this.hasActiveFilters = $derived(filters.hasActiveFilters);
		this.selectedFilterChips = $derived(filters.selectedChips);
	}

	items: TodoItem[];
	skipped: SkippedLine[];
	filteredItems: TodoItem[];
	availableProjects: string[];
	availableContexts: string[];
	availablePriorities: string[];
	totalCount: number;
	visibleCount: number;
	hasActiveFilters: boolean;
	selectedFilterChips: TodoFilterState["selectedChips"];
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
