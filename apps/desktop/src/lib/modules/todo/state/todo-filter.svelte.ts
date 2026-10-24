import type { SavedViewFilterValues, TodoSortOrder } from "@tuxedo/contracts";
import { summarizeTodoFilterFacets } from "../domain/todo-filter-facets";
import type { TodoItem } from "#lib/modules/todo/domain/todo.js";
import { dueCategory, localToday, validDueDate, type TodoDueCategory } from "../domain/todo-due";

import { isDeferred } from "../domain/todo-threshold";

export type TodoFilterStatus = "all" | "open" | "completed";

export type TodoFilterFacets = Readonly<{
	projects: readonly string[];
	contexts: readonly string[];
	priorities: readonly string[];
}>;

export class TodoFilterState {
	private preserveSelections = false;
	private workspaceKey: string | null | undefined;
	constructor(
		private readonly getItems: () => readonly TodoItem[],
		private readonly getPreferences: () => {
			readonly sort_order?: TodoSortOrder;
			readonly show_deferred?: boolean;
		}
	) {}
	private get items() {
		return this.getItems();
	}
	status = $state<TodoFilterStatus>("all");
	get sortOrder() {
		return this.getPreferences().sort_order ?? "file";
	}
	get showDeferred() {
		return this.getPreferences().show_deferred ?? false;
	}
	deferredCount = $derived(
		this.items.filter((item) => this.matchesFilters(item) && isDeferred(item, this.today)).length
	);
	availableFacets = $derived(
		summarizeTodoFilterFacets(
			this.items,
			this.status === "all" ? null : this.status === "completed"
		)
	);
	selectedProject = $state<string | null>(null);
	selectedContext = $state<string | null>(null);
	selectedPriority = $state<string | null>(null);
	selectedDue = $state<TodoDueCategory | null>(null);
	searchText = $state("");
	private searchTerms = $derived(this.searchText.toLowerCase().split(/\s+/).filter(Boolean));
	hasSearch = $derived(this.searchTerms.length > 0);
	today = $state(localToday());
	invalidDueCount = $derived(
		this.items.filter(
			(item) => !item.completed && dueCategory(item.metadata.due, this.today) === "invalid"
		).length
	);

	toggleDue = (category: TodoDueCategory) => {
		if (this.status === "completed") return;
		this.selectedDue = this.selectedDue === category ? null : category;
	};
	clearDue = () => {
		this.selectedDue = null;
	};
	clearSearch = () => {
		this.searchText = "";
	};

	get hasFilters() {
		return (
			this.hasSearch ||
			this.selectedProject !== null ||
			this.selectedContext !== null ||
			this.selectedPriority !== null ||
			this.selectedDue !== null
		);
	}

	get activePriority() {
		return this.status !== "completed" ? this.selectedPriority : null;
	}

	setStatus = (status: TodoFilterStatus) => {
		this.status = status;
		if (status === "completed") this.clearDue();
		this.reconcile(this.availableFacets);
	};

	toggleProject = (project: string) => {
		this.selectedProject = this.selectedProject === project ? null : project;
	};
	clearProject = () => {
		this.selectedProject = null;
	};

	toggleContext = (context: string) => {
		this.selectedContext = this.selectedContext === context ? null : context;
	};
	clearContext = () => {
		this.selectedContext = null;
	};

	togglePriority = (priority: string) => {
		if (this.status === "completed") return;
		this.selectedPriority = this.selectedPriority === priority ? null : priority;
	};
	clearPriority = () => {
		if (this.status !== "completed") this.selectedPriority = null;
	};

	clear = () => {
		this.preserveSelections = false;
		this.clearSearch();
		this.clearDue();
		this.selectedProject = null;
		this.selectedContext = null;
		this.selectedPriority = null;
	};

	reset = () => {
		this.status = "all";
		this.clear();
	};

	sync = (workspaceKey: string | null) => {
		if (this.workspaceKey !== workspaceKey) {
			this.workspaceKey = workspaceKey;
			this.reset();
		}
		if (!this.preserveSelections && this.selectedDue === "invalid" && this.invalidDueCount === 0)
			this.clearDue();
		this.reconcile(this.availableFacets);
	};

	reconcile = (facets: TodoFilterFacets) => {
		if (this.preserveSelections) return;
		if (this.selectedProject !== null && !facets.projects.includes(this.selectedProject)) {
			this.selectedProject = null;
		}
		if (this.selectedContext !== null && !facets.contexts.includes(this.selectedContext)) {
			this.selectedContext = null;
		}
		if (this.selectedPriority !== null && !facets.priorities.includes(this.selectedPriority)) {
			this.selectedPriority = null;
		}
	};

	snapshot = (): SavedViewFilterValues => ({
		status: this.status,
		search: this.searchText,
		project: this.selectedProject,
		context: this.selectedContext,
		priority: this.activePriority,
		due: this.selectedDue,
	});
	applyView = (filters: SavedViewFilterValues) => {
		this.preserveSelections = true;
		this.status = filters.status;
		this.searchText = filters.search;
		this.selectedProject = filters.project;
		this.selectedContext = filters.context;
		this.selectedPriority = filters.priority;
		this.selectedDue = filters.due;
	};

	private matchesFilters = (item: TodoItem) => {
		if (
			this.selectedDue !== null &&
			(item.completed || dueCategory(item.metadata.due, this.today) !== this.selectedDue)
		)
			return false;
		if (this.status !== "all" && (this.status === "completed") !== item.completed) return false;
		if (this.selectedProject !== null && !item.projects.includes(this.selectedProject))
			return false;
		if (this.selectedContext !== null && !item.contexts.includes(this.selectedContext))
			return false;
		if (this.activePriority !== null && item.priority !== this.activePriority) return false;
		if (this.hasSearch) {
			const text = [
				item.description,
				...item.projects.map((project) => `+${project}`),
				...item.contexts.map((context) => `@${context}`),
				...Object.entries(item.metadata).map(([key, value]) => `${key}:${value}`),
			]
				.join(" ")
				.toLowerCase();
			if (!this.searchTerms.every((term) => text.includes(term))) return false;
		}
		return true;
	};

	filterItems = (items: readonly TodoItem[]) => {
		const filtered = items.filter(
			(item) => this.matchesFilters(item) && (this.showDeferred || !isDeferred(item, this.today))
		);
		if (this.sortOrder === "due")
			filtered.sort((left, right) => {
				const a = validDueDate(left.metadata.due);
				const b = validDueDate(right.metadata.due);
				if (a === b) return left.line_number - right.line_number;
				if (!a) return 1;
				if (!b) return -1;
				return a < b ? -1 : 1;
			});
		return filtered;
	};
}
