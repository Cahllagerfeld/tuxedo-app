import type { SavedViewFilterValues, TodoSortOrder } from "$lib/shared/desktop/contract";
import { summarizeTodoFilterFacets } from "../domain/todo-filter-facets";
import type { TodoItem } from "$lib/modules/todo/domain/todo";
import { dueCategory, localToday, validDueDate, type TodoDueCategory } from "../domain/todo-due";

import { isDeferred } from "../domain/todo-threshold";
import { emptyTodoFilters, readTodoFilters, writeTodoFilters } from "./todo-filter-url";

export type TodoFilterURL = { read: () => URL; write: (url: URL) => void };

export type TodoFilterStatus = "all" | "open" | "completed";

export type TodoFilterFacets = Readonly<{
	projects: readonly string[];
	contexts: readonly string[];
	priorities: readonly string[];
}>;

export class TodoFilterState {
	constructor(private readonly url?: TodoFilterURL) {
		this.values = $derived(this.url ? readTodoFilters(this.url.read()) : this.localFilters);
	}
	private localFilters = $state(emptyTodoFilters());
	private values: SavedViewFilterValues;
	private update = (filters: SavedViewFilterValues) => {
		if (this.url) this.url.write(writeTodoFilters(this.url.read(), filters));
		else this.localFilters = filters;
	};
	get status() {
		return this.values.status;
	}
	set status(status: TodoFilterStatus) {
		this.update({ ...this.values, status });
	}
	get selectedProject() {
		return this.values.project;
	}
	set selectedProject(project: string | null) {
		this.update({ ...this.values, project });
	}
	get selectedContext() {
		return this.values.context;
	}
	set selectedContext(context: string | null) {
		this.update({ ...this.values, context });
	}
	get selectedPriority() {
		return this.values.priority;
	}
	set selectedPriority(priority: string | null) {
		this.update({ ...this.values, priority });
	}
	get selectedDue() {
		return this.values.due;
	}
	set selectedDue(due: TodoDueCategory | null) {
		this.update({ ...this.values, due });
	}
	get searchText() {
		return this.values.search;
	}
	set searchText(search: string) {
		this.update({ ...this.values, search });
	}
	private preserveSelections = false;
	private workspaceKey: string | null | undefined;
	private items = $state.raw<readonly TodoItem[]>([]);
	sortOrder = $state<TodoSortOrder>("file");
	showDeferred = $state(false);
	deferredCount = $derived(
		this.items.filter((item) => this.matchesFilters(item) && isDeferred(item, this.today)).length
	);
	availableFacets = $derived(
		summarizeTodoFilterFacets(
			this.items,
			this.status === "all" ? null : this.status === "completed"
		)
	);
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
		this.update({
			...this.values,
			status,
			...(status === "completed" ? { due: null, priority: null } : {}),
		});
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
		this.update({ ...emptyTodoFilters(), status: this.status });
	};

	reset = () => {
		this.status = "all";
		this.sortOrder = "file";
		this.showDeferred = false;
		this.clear();
	};

	sync = (
		workspaceKey: string | null,
		items: readonly TodoItem[],
		sortOrder?: TodoSortOrder,
		showDeferred?: boolean
	) => {
		this.items = items;
		if (this.workspaceKey !== workspaceKey) {
			this.workspaceKey = workspaceKey;
			if (!this.url) this.reset();
			else {
				this.sortOrder = "file";
				this.showDeferred = false;
			}
		}
		if (sortOrder !== undefined) this.sortOrder = sortOrder;
		if (showDeferred !== undefined) this.showDeferred = showDeferred;
		if (
			!this.url &&
			!this.preserveSelections &&
			this.selectedDue === "invalid" &&
			this.invalidDueCount === 0
		)
			this.clearDue();
		this.reconcile(this.availableFacets);
	};

	reconcile = (facets: TodoFilterFacets) => {
		if (this.url || this.preserveSelections) return;
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
		this.update(filters);
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
