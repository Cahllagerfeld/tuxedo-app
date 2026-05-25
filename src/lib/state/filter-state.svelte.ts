import type { TodoItem } from "$lib/todo";

export type FilterChipKind = "project" | "context" | "priority" | "search";

export interface FilterChip {
	kind: FilterChipKind;
	value: string;
	label: string;
}

export class TodoFilterState {
	query = $state("");
	selectedProjects = $state<string[]>([]);
	selectedContexts = $state<string[]>([]);
	selectedPriorities = $state<string[]>([]);
	private normalizedQuery = $derived(this.query.trim().toLocaleLowerCase());

	selectedChips = $derived<FilterChip[]>([
		...(this.normalizedQuery
			? [
					{
						kind: "search" as const,
						value: this.query,
						label: `Search: ${this.query}`,
					},
				]
			: []),
		...this.selectedProjects.map((value) => ({
			kind: "project" as const,
			value,
			label: `+${value}`,
		})),
		...this.selectedContexts.map((value) => ({
			kind: "context" as const,
			value,
			label: `@${value}`,
		})),
		...this.selectedPriorities.map((value) => ({
			kind: "priority" as const,
			value,
			label: `(${value})`,
		})),
	]);

	hasActiveFilters = $derived(
		this.normalizedQuery.length > 0 ||
			this.selectedProjects.length > 0 ||
			this.selectedContexts.length > 0 ||
			this.selectedPriorities.length > 0
	);

	filterItems(items: TodoItem[]): TodoItem[] {
		if (!this.hasActiveFilters) {
			return items;
		}

		return items.filter((item) => this.matchesQuery(item) && this.matchesChips(item));
	}

	toggleProject = (project: string) => {
		this.selectedProjects = toggleSelection(this.selectedProjects, project);
	};

	toggleContext = (context: string) => {
		this.selectedContexts = toggleSelection(this.selectedContexts, context);
	};

	togglePriority = (priority: string) => {
		this.selectedPriorities = toggleSelection(this.selectedPriorities, priority);
	};

	removeChip = (chip: FilterChip) => {
		if (chip.kind === "project") {
			this.selectedProjects = this.selectedProjects.filter((project) => project !== chip.value);
			return;
		}

		if (chip.kind === "context") {
			this.selectedContexts = this.selectedContexts.filter((context) => context !== chip.value);
			return;
		}

		if (chip.kind === "priority") {
			this.selectedPriorities = this.selectedPriorities.filter(
				(priority) => priority !== chip.value
			);
			return;
		}

		this.query = "";
	};

	clear = () => {
		this.query = "";
		this.selectedProjects = [];
		this.selectedContexts = [];
		this.selectedPriorities = [];
	};

	private matchesQuery(item: TodoItem): boolean {
		if (!this.normalizedQuery) {
			return true;
		}

		const searchableText = [
			item.description,
			item.priority,
			...item.projects.map((project) => `+${project}`),
			...item.contexts.map((context) => `@${context}`),
			...Object.values(item.metadata),
		]
			.filter((value): value is string => Boolean(value))
			.join(" ")
			.toLocaleLowerCase();

		return searchableText.includes(this.normalizedQuery);
	}

	private matchesChips(item: TodoItem): boolean {
		return (
			matchesAnySelected(this.selectedProjects, item.projects) &&
			matchesAnySelected(this.selectedContexts, item.contexts) &&
			matchesAnySelected(this.selectedPriorities, item.priority ? [item.priority] : [])
		);
	}
}

function toggleSelection(selected: string[], value: string): string[] {
	return selected.includes(value)
		? selected.filter((selectedValue) => selectedValue !== value)
		: [...selected, value];
}

function matchesAnySelected(selected: string[], values: string[]): boolean {
	return selected.length === 0 || selected.some((value) => values.includes(value));
}
