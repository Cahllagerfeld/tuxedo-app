import type { TodoFile } from "$lib/todo";
import { describe, expect, it } from "vitest";
import { TodoFilterState } from "./filter-state.svelte";
import { TodoViewState } from "./todo-view-state.svelte";
import { WorkspaceState } from "./workspace-state.svelte";

const todoFile: TodoFile = {
	path: "/tmp/todo.txt",
	items: [
		{
			line_number: 1,
			raw: "(B) Buy screws +House @hardware area:garage",
			completed: false,
			priority: "B",
			creation_date: null,
			completion_date: null,
			description: "Buy screws",
			projects: ["House"],
			contexts: ["hardware"],
			metadata: { area: "garage" },
		},
		{
			line_number: 2,
			raw: "(A) Refactor state +Tuxedo @computer area:desk",
			completed: false,
			priority: "A",
			creation_date: null,
			completion_date: null,
			description: "Refactor state",
			projects: ["Tuxedo"],
			contexts: ["computer"],
			metadata: { area: "desk" },
		},
		{
			line_number: 3,
			raw: "x Ship release +Tuxedo @computer",
			completed: true,
			priority: null,
			creation_date: null,
			completion_date: null,
			description: "Ship release",
			projects: ["Tuxedo"],
			contexts: ["computer"],
			metadata: {},
		},
	],
	skipped: [
		{
			line_number: 4,
			raw: "bad line",
			reason: "invalid todo",
		},
	],
};

describe("TodoViewState", () => {
	it("starts empty before a workspace todo file is loaded", () => {
		const workspace = new WorkspaceState();
		const filters = new TodoFilterState();
		const view = new TodoViewState(workspace, filters);

		expect(view.items).toEqual([]);
		expect(view.skipped).toEqual([]);
		expect(view.filteredItems).toEqual([]);
		expect(view.totalCount).toBe(0);
		expect(view.visibleCount).toBe(0);
		expect(view.availableProjects).toEqual([]);
		expect(view.availableContexts).toEqual([]);
		expect(view.availablePriorities).toEqual([]);
	});

	it("derives items, skipped lines, counts, and sorted facets from workspace data", () => {
		const workspace = new WorkspaceState();
		const filters = new TodoFilterState();
		const view = new TodoViewState(workspace, filters);

		workspace.todoFile = todoFile;

		expect(view.items).toHaveLength(3);
		expect(view.skipped).toEqual(todoFile.skipped);
		expect(view.totalCount).toBe(3);
		expect(view.visibleCount).toBe(3);
		expect(view.availableProjects).toEqual(["House", "Tuxedo"]);
		expect(view.availableContexts).toEqual(["computer", "hardware"]);
		expect(view.availablePriorities).toEqual(["A", "B"]);
	});

	it("derives filtered items and selected chips from filter state", () => {
		const workspace = new WorkspaceState();
		const filters = new TodoFilterState();
		const view = new TodoViewState(workspace, filters);

		workspace.todoFile = todoFile;
		filters.toggleProject("Tuxedo");
		filters.togglePriority("A");

		expect(view.hasActiveFilters).toBe(true);
		expect(view.filteredItems.map((item) => item.line_number)).toEqual([2]);
		expect(view.visibleCount).toBe(1);
		expect(view.selectedFilterChips.map((chip) => chip.label)).toEqual(["+Tuxedo", "(A)"]);
	});

	it("updates visible counts when filters change", () => {
		const workspace = new WorkspaceState();
		const filters = new TodoFilterState();
		const view = new TodoViewState(workspace, filters);

		workspace.todoFile = todoFile;
		expect(view.visibleCount).toBe(3);

		filters.toggleContext("computer");
		expect(view.visibleCount).toBe(2);

		filters.togglePriority("A");
		expect(view.visibleCount).toBe(1);
	});

	it("reacts when the workspace todo file is replaced", () => {
		const workspace = new WorkspaceState();
		const filters = new TodoFilterState();
		const view = new TodoViewState(workspace, filters);

		workspace.todoFile = todoFile;
		expect(view.totalCount).toBe(3);

		workspace.todoFile = {
			path: "/tmp/empty.txt",
			items: [],
			skipped: [],
		};

		expect(view.items).toEqual([]);
		expect(view.filteredItems).toEqual([]);
		expect(view.totalCount).toBe(0);
		expect(view.availableProjects).toEqual([]);
	});
});
