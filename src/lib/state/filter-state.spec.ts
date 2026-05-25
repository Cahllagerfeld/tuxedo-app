import type { TodoItem } from "$lib/todo";
import { describe, expect, it } from "vitest";
import { TodoFilterState } from "./filter-state.svelte";

const todoItems: TodoItem[] = [
	{
		line_number: 1,
		raw: "(A) Write parser tests +Tuxedo @computer due:2026-05-26",
		completed: false,
		priority: "A",
		creation_date: "2026-05-25",
		completion_date: null,
		description: "Write parser tests",
		projects: ["Tuxedo"],
		contexts: ["computer"],
		metadata: { due: "2026-05-26" },
	},
	{
		line_number: 2,
		raw: "(B) Call supplier +House @phone area:kitchen",
		completed: false,
		priority: "B",
		creation_date: null,
		completion_date: null,
		description: "Call supplier",
		projects: ["House"],
		contexts: ["phone"],
		metadata: { area: "kitchen" },
	},
	{
		line_number: 3,
		raw: "x 2026-05-24 Done cleanup +Tuxedo @computer",
		completed: true,
		priority: null,
		creation_date: null,
		completion_date: "2026-05-24",
		description: "Done cleanup",
		projects: ["Tuxedo"],
		contexts: ["computer"],
		metadata: {},
	},
];

describe("TodoFilterState", () => {
	it("returns all items when no filters are active", () => {
		const filters = new TodoFilterState();

		expect(filters.hasActiveFilters).toBe(false);
		expect(filters.filterItems(todoItems)).toBe(todoItems);
	});

	it("ORs selected values within one category", () => {
		const filters = new TodoFilterState();

		filters.toggleProject("Tuxedo");
		filters.toggleProject("House");

		expect(filters.filterItems(todoItems).map((item) => item.line_number)).toEqual([1, 2, 3]);
	});

	it("ANDs selected values across different categories", () => {
		const filters = new TodoFilterState();

		filters.toggleProject("Tuxedo");
		filters.toggleContext("computer");
		filters.togglePriority("A");

		expect(filters.filterItems(todoItems).map((item) => item.line_number)).toEqual([1]);
	});

	it("returns no items when selected categories have no overlap", () => {
		const filters = new TodoFilterState();

		filters.toggleProject("House");
		filters.toggleContext("computer");

		expect(filters.filterItems(todoItems)).toEqual([]);
	});

	it("filters by priority and excludes items without a priority", () => {
		const filters = new TodoFilterState();

		filters.togglePriority("A");
		filters.togglePriority("B");

		expect(filters.filterItems(todoItems).map((item) => item.line_number)).toEqual([1, 2]);
	});

	it("searches case-insensitively across descriptions, tags, priority, and metadata values", () => {
		const filters = new TodoFilterState();

		filters.query = "  KITCHEN  ";

		expect(filters.filterItems(todoItems).map((item) => item.line_number)).toEqual([2]);
	});

	it("toggles selected values off", () => {
		const filters = new TodoFilterState();

		filters.toggleProject("Tuxedo");
		filters.toggleProject("Tuxedo");
		filters.toggleContext("computer");
		filters.toggleContext("computer");
		filters.togglePriority("A");
		filters.togglePriority("A");

		expect(filters.selectedProjects).toEqual([]);
		expect(filters.selectedContexts).toEqual([]);
		expect(filters.selectedPriorities).toEqual([]);
		expect(filters.hasActiveFilters).toBe(false);
	});

	it("derives selected filter chips and removes them independently", () => {
		const filters = new TodoFilterState();

		filters.query = "parser";
		filters.toggleProject("Tuxedo");
		filters.toggleContext("computer");
		filters.togglePriority("A");

		expect(filters.selectedChips.map((chip) => chip.label)).toEqual([
			"Search: parser",
			"+Tuxedo",
			"@computer",
			"(A)",
		]);

		for (const chip of [...filters.selectedChips]) {
			filters.removeChip(chip);
		}

		expect(filters.hasActiveFilters).toBe(false);
		expect(filters.selectedChips).toEqual([]);
	});

	it("clears all filter categories", () => {
		const filters = new TodoFilterState();

		filters.query = "parser";
		filters.toggleProject("Tuxedo");
		filters.toggleContext("computer");
		filters.togglePriority("A");
		filters.clear();

		expect(filters.query).toBe("");
		expect(filters.selectedProjects).toEqual([]);
		expect(filters.selectedContexts).toEqual([]);
		expect(filters.selectedPriorities).toEqual([]);
		expect(filters.hasActiveFilters).toBe(false);
	});
});
