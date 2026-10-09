import type { TodoItem } from "$lib/modules/todo/domain/todo";

export type TodoFilterStatus = "open" | "completed";

export type TodoFilterFacets = Readonly<{
	projects: readonly string[];
	contexts: readonly string[];
	priorities: readonly string[];
}>;

export class TodoFilterState {
	private workspaceKey: string | null | undefined;
	status = $state<TodoFilterStatus>("open");
	selectedProject = $state<string | null>(null);
	selectedContext = $state<string | null>(null);
	selectedPriority = $state<string | null>(null);

	get hasFacetFilters() {
		return (
			this.selectedProject !== null ||
			this.selectedContext !== null ||
			this.selectedPriority !== null
		);
	}

	get activePriority() {
		return this.status === "open" ? this.selectedPriority : null;
	}

	setStatus = (status: TodoFilterStatus) => {
		this.status = status;
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
		this.selectedProject = null;
		this.selectedContext = null;
		this.selectedPriority = null;
	};

	reset = () => {
		this.status = "open";
		this.clear();
	};

	sync = (workspaceKey: string | null, facets: TodoFilterFacets) => {
		if (this.workspaceKey !== workspaceKey) {
			this.workspaceKey = workspaceKey;
			this.reset();
		}
		this.reconcile(facets);
	};

	reconcile = (facets: TodoFilterFacets) => {
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

	filterItems = (items: readonly TodoItem[]) =>
		items.filter((item) => {
			if ((this.status === "completed") !== item.completed) return false;
			if (this.selectedProject !== null && !item.projects.includes(this.selectedProject))
				return false;
			if (this.selectedContext !== null && !item.contexts.includes(this.selectedContext))
				return false;
			if (this.activePriority !== null && item.priority !== this.activePriority) return false;
			return true;
		});
}
