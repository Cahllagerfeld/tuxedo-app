import type { TodoFile } from "$lib/modules/todo/domain/todo";
import { WorkspaceState } from "$lib/modules/workspace/state/workspace-state.svelte";
import { describe, expect, it } from "vitest";
import { TodoViewState } from "./todo-view-state.svelte";

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
		{
			line_number: 5,
			raw: "(C) Schedule inspection +House @phone",
			completed: false,
			priority: "C",
			creation_date: null,
			completion_date: null,
			description: "Schedule inspection",
			projects: ["House"],
			contexts: ["phone"],
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
		const view = new TodoViewState(workspace);

		expect(view.items).toEqual([]);
		expect(view.skipped).toEqual([]);
		expect(view.totalCount).toBe(0);
		expect(view.visibleCount).toBe(0);
		expect(view.openCount).toBe(0);
		expect(view.completedCount).toBe(0);
		expect(view.priorityCount).toBe(0);
		expect(view.projectCount).toBe(0);
		expect(view.availableProjects).toEqual([]);
		expect(view.availableContexts).toEqual([]);
		expect(view.availablePriorities).toEqual([]);
	});

	it("derives items, skipped lines, counts, and sorted facets from workspace data", () => {
		const workspace = new WorkspaceState();
		const view = new TodoViewState(workspace);

		workspace.todoFile = todoFile;

		expect(view.items).toHaveLength(4);
		expect(view.skipped).toEqual(todoFile.skipped);
		expect(view.totalCount).toBe(4);
		expect(view.visibleCount).toBe(4);
		expect(view.openCount).toBe(3);
		expect(view.completedCount).toBe(1);
		expect(view.priorityCount).toBe(3);
		expect(view.projectCount).toBe(2);
		expect(view.availableProjects).toEqual(["House", "Tuxedo"]);
		expect(view.availableContexts).toEqual(["computer", "hardware", "phone"]);
		expect(view.availablePriorities).toEqual(["A", "B", "C"]);
	});

	it("reacts when the workspace todo file is replaced", () => {
		const workspace = new WorkspaceState();
		const view = new TodoViewState(workspace);

		workspace.todoFile = todoFile;
		expect(view.totalCount).toBe(4);

		workspace.todoFile = {
			path: "/tmp/empty.txt",
			items: [],
			skipped: [],
		};

		expect(view.items).toEqual([]);
		expect(view.totalCount).toBe(0);
		expect(view.openCount).toBe(0);
		expect(view.completedCount).toBe(0);
		expect(view.priorityCount).toBe(0);
		expect(view.projectCount).toBe(0);
		expect(view.availableProjects).toEqual([]);
	});

	it("clears derived state when a loaded workspace has no todo file", () => {
		const workspace = new WorkspaceState();
		const view = new TodoViewState(workspace);

		workspace.todoFile = todoFile;
		expect(view.totalCount).toBe(4);

		workspace.todoFile = null;

		expect(view.items).toEqual([]);
		expect(view.skipped).toEqual([]);
		expect(view.totalCount).toBe(0);
		expect(view.visibleCount).toBe(0);
		expect(view.openCount).toBe(0);
		expect(view.completedCount).toBe(0);
		expect(view.availableProjects).toEqual([]);
		expect(view.availableContexts).toEqual([]);
		expect(view.availablePriorities).toEqual([]);
	});

	it("deduplicates and sorts available facets from loaded tasks", () => {
		const workspace = new WorkspaceState();
		const view = new TodoViewState(workspace);

		workspace.todoFile = {
			path: "/tmp/facets.txt",
			items: [
				{
					line_number: 1,
					raw: "(C) Paint trim +House +Tuxedo @phone @computer",
					completed: false,
					priority: "C",
					creation_date: null,
					completion_date: null,
					description: "Paint trim",
					projects: ["House", "Tuxedo"],
					contexts: ["phone", "computer"],
					metadata: {},
				},
				{
					line_number: 2,
					raw: "(A) Order paint +House @hardware @phone",
					completed: false,
					priority: "A",
					creation_date: null,
					completion_date: null,
					description: "Order paint",
					projects: ["House"],
					contexts: ["hardware", "phone"],
					metadata: {},
				},
			],
			skipped: [],
		};

		expect(view.availableProjects).toEqual(["House", "Tuxedo"]);
		expect(view.availableContexts).toEqual(["computer", "hardware", "phone"]);
		expect(view.availablePriorities).toEqual(["A", "C"]);
		expect(view.projectCount).toBe(2);
		expect(view.priorityCount).toBe(2);
	});
});
