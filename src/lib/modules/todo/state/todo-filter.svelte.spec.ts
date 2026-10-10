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
};

describe("TodoFilterState", () => {
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

		expect(filter.status).toBe("open");
		expect(filter.selectedProject).toBeNull();
		expect(filter.selectedContext).toBeNull();
		expect(filter.selectedPriority).toBeNull();
	});
});
