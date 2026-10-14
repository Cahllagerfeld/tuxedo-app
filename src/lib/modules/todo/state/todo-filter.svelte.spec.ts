import { describe, expect, it } from "vitest";
import type { TodoItem } from "../domain/todo";
import { TodoFilterState } from "./todo-filter.svelte";

const open: TodoItem = {
	line_number: 1,
	raw: "(A) Open +Work @Home",
	completed: false,
	priority: "A",
	creation_date: null,
	completion_date: null,
	description: "Open",
	projects: ["Work"],
	contexts: ["Home"],
	metadata: {},

	edit: { description: "Open", metadata: [] },
};

const completed: TodoItem = {
	line_number: 2,
	raw: "x 2026-10-09 Completed +Work @Home",
	completed: true,
	priority: null,
	creation_date: null,
	completion_date: "2026-10-09",
	description: "Completed",
	projects: ["Work"],
	contexts: ["Home"],
	metadata: {},

	edit: { description: "Completed", metadata: [] },
};

describe("TodoFilterState", () => {
	it("combines due categories with status and facets, preserving malformed dates", () => {
		const items: TodoItem[] = [
			{ ...open, line_number: 1, metadata: { due: "2026-10-13" } },
			{ ...open, line_number: 2, metadata: { due: "2026-10-14" } },
			{ ...open, line_number: 3, metadata: { due: "2026-10-15" } },
			{ ...open, line_number: 4, metadata: { due: "2026-02-30" } },
			{ ...open, line_number: 5, metadata: {} },
			{ ...completed, line_number: 6, metadata: { due: "2026-10-13" } },
		];
		const filter = new TodoFilterState();
		filter.sync("work", items);
		filter.today = "2026-10-14";
		filter.toggleDue("overdue");
		expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([1, 6]);
		filter.setStatus("open");
		expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([1]);
		filter.toggleDue("today");
		expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([2]);
		filter.today = "2026-10-15";
		expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([3]);
		filter.toggleDue("upcoming");
		expect(filter.filterItems(items)).toEqual([]);
		filter.toggleDue("none");
		expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([4, 5]);
		filter.toggleProject("Other");
		expect(filter.filterItems(items)).toEqual([]);
		filter.clear();
		expect(filter.selectedDue).toBeNull();
		expect(filter.filterItems(items)).toHaveLength(5);
		filter.toggleDue("today");
		filter.sync("personal", items);
		expect(filter.selectedDue).toBeNull();
	});
	it("defaults to All and filters both completion states and their combined facets", () => {
		const completedOnly = { ...completed, projects: ["Personal"], contexts: ["Away"] };
		const items = [open, completedOnly];
		const filter = new TodoFilterState();
		expect(filter.status).toBe("all");
		filter.sync("work", items);
		expect(filter.status).toBe("all");

		expect(filter.filterItems(items)).toEqual(items);
		expect(filter.availableFacets.projects).toEqual(["Personal", "Work"]);
		expect(filter.availableFacets.contexts).toEqual(["Away", "Home"]);
		expect(filter.availableFacets.counts.projects.get("Personal")).toBe(1);
		filter.toggleProject("Personal");
		filter.toggleContext("Away");
		expect(filter.filterItems(items)).toEqual([completedOnly]);
		filter.clear();
		filter.togglePriority("A");
		expect(filter.filterItems(items)).toEqual([open]);
		filter.setStatus("completed");
		expect(filter.selectedPriority).toBeNull();
		expect(filter.filterItems(items)).toEqual([completedOnly]);
	});

	it("combines exact selections and clears Priority in Completed", () => {
		const filter = new TodoFilterState();
		filter.sync("work", [open, completed]);
		filter.toggleProject("Work");
		filter.toggleContext("Home");
		filter.togglePriority("A");

		expect(filter.filterItems([open, completed])).toEqual([open]);
		filter.setStatus("completed");
		expect(filter.selectedPriority).toBeNull();
		expect(filter.filterItems([open, completed])).toEqual([completed]);
		filter.setStatus("open");
		expect(filter.filterItems([open, completed])).toEqual([open]);
	});

	it("resets status and selections for another Workspace and reconciles obsolete values", () => {
		const filter = new TodoFilterState();
		filter.sync("work", [open, completed]);
		filter.setStatus("completed");
		filter.toggleProject("Work");
		filter.sync("personal", [{ ...open, projects: ["Personal"], contexts: [], priority: null }]);

		expect(filter.status).toBe("all");
		expect(filter.selectedProject).toBeNull();
		expect(filter.selectedContext).toBeNull();
		expect(filter.selectedPriority).toBeNull();
	});
});
