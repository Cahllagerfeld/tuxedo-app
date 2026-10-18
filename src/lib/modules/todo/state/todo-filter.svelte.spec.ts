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
	it("reads destination filters and writes edits into the same URL without losing unrelated state", () => {
		const destination = $state({
			url: new URL(
				"https://tuxedo.test/workspaces/work?search=open&project=Work&context=Home&priority=A&status=open&due=none&item=7#reader"
			),
		});
		const filter = new TodoFilterState({
			read: () => destination.url,
			write: (next) => {
				destination.url = next;
			},
		});
		filter.sync("work", [open, completed]);
		expect(filter.filterItems([open, completed])).toEqual([open]);
		filter.searchText = "completed";
		expect(destination.url.searchParams.get("search")).toBe("completed");
		expect(destination.url.searchParams.get("item")).toBe("7");
		expect(destination.url.hash).toBe("#reader");
		filter.setStatus("completed");
		expect(destination.url.searchParams.has("due")).toBe(false);
		expect(destination.url.searchParams.has("priority")).toBe(false);
		expect(filter.filterItems([open, completed])).toEqual([completed]);
		destination.url = new URL("https://tuxedo.test/workspaces/other?project=Absent&status=open");
		filter.sync("other", [open, completed]);
		expect(filter.selectedProject).toBe("Absent");
		expect(filter.filterItems([open, completed])).toEqual([]);
		filter.clear();
		expect(filter.filterItems([open, completed])).toEqual([open]);
	});
	it("applies saved views to URL filters with exact values and ignores malformed fields safely", () => {
		const destination = $state({
			url: new URL(
				"https://tuxedo.test/workspaces/work?status=bad&priority=AA&due=yesterday&project=two+words&context=Home"
			),
		});
		const filter = new TodoFilterState({
			read: () => destination.url,
			write: (url) => {
				destination.url = url;
			},
		});
		filter.sync("work", [open, completed], "due", true);
		expect(filter.filterItems([open, completed])).toEqual([open, completed]);
		expect(filter.snapshot()).toEqual({
			status: "all",
			search: "",
			project: null,
			context: "Home",
			priority: null,
			due: null,
		});
		const view = {
			status: "open",
			search: "  café & +Work%  ",
			project: "工程&Work%",
			context: "Home",
			priority: "A",
			due: "none",
		} as const;
		filter.applyView(view);
		expect(filter.snapshot()).toEqual(view);
		const restored = new TodoFilterState({
			read: () => new URL(destination.url.href),
			write: () => {},
		});
		restored.sync("work", [open, completed]);
		expect(restored.snapshot()).toEqual(view);
		expect(restored.filterItems([open, completed])).toEqual([]);
		expect(filter.sortOrder).toBe("due");
		expect(filter.showDeferred).toBe(true);
	});
	it("sorts Due dates without changing the source, leaving ties and undated items in file order", () => {
		const items: TodoItem[] = [
			{ ...open, line_number: 1, metadata: {} },
			{ ...open, line_number: 2, metadata: { due: "2026-11-01" } },
			{ ...completed, line_number: 3, metadata: { due: "2026-10-14" } },
			{ ...open, line_number: 4, metadata: { due: "2026-02-30" } },
			{ ...open, line_number: 5, metadata: { due: "2026-10-14" } },
		];
		const filter = new TodoFilterState();
		filter.sync("work", items);
		expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([1, 2, 3, 4, 5]);
		filter.sortOrder = "due";
		expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([3, 5, 2, 1, 4]);
		expect(items.map((item) => item.line_number)).toEqual([1, 2, 3, 4, 5]);
		filter.setStatus("open");
		expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([5, 2, 1, 4]);
		filter.sync("work", items);
		expect(filter.sortOrder).toBe("due");
		filter.sortOrder = "file";
		expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([1, 2, 4, 5]);
		filter.sortOrder = "due";
		filter.sync("personal", items);
		expect(filter.sortOrder).toBe("file");
	});
	it("searches literal terms across description, Projects, Contexts, and metadata in file order", () => {
		const release = {
			...open,
			description: "Release client [v2]",
			metadata: { due: "2026-10-14" },
		};
		const other = { ...completed, description: "Client follow-up" };
		const items = [release, other];
		const filter = new TodoFilterState();
		filter.sync("work", items);
		filter.searchText = "  CLIENT\t release  ";
		expect(filter.filterItems(items)).toEqual([release]);
		filter.searchText = "+work @HOME due:2026-10-14 [v2]";
		expect(filter.filterItems(items)).toEqual([release]);
		filter.searchText = "client";
		expect(filter.filterItems(items)).toEqual(items);
		filter.searchText = "rel.*";
		expect(filter.filterItems(items)).toEqual([]);
		filter.searchText = " \n\t ";
		expect(filter.filterItems(items)).toEqual(items);
		expect(filter.hasFilters).toBe(false);
	});
	it("combines search with other filters, retains it on reload, and resets it on Workspace switch", () => {
		const dated = { ...open, metadata: { due: "2026-10-14" } };
		const items = [dated, completed];
		const filter = new TodoFilterState();
		filter.sync("work", items);
		filter.today = "2026-10-14";
		filter.searchText = "home";
		filter.toggleProject("Work");
		filter.toggleContext("Home");
		filter.togglePriority("A");
		filter.toggleDue("today");
		expect(filter.filterItems(items)).toEqual([dated]);
		filter.setStatus("completed");
		expect(filter.filterItems(items)).toEqual([completed]);
		filter.searchText = "open";
		expect(filter.filterItems(items)).toEqual([]);
		filter.setStatus("all");
		const updated = [{ ...dated, description: "Changed", contexts: [] }, completed];
		filter.sync("work", updated);
		expect(filter.searchText).toBe("open");
		expect(filter.filterItems(updated)).toEqual([]);
		filter.clearSearch();
		expect(filter.selectedProject).toBe("Work");
		expect(filter.filterItems(updated)).toEqual([completed]);
		filter.searchText = "changed";
		filter.clear();
		expect(filter.hasFilters).toBe(false);
		expect(filter.searchText).toBe("");
		expect(filter.filterItems(updated)).toEqual(updated);
		filter.searchText = "changed";
		filter.sync("personal", updated);
		expect(filter.searchText).toBe("");
	});
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
		expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([1]);
		filter.setStatus("open");
		expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([1]);
		filter.toggleDue("today");
		expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([2]);
		filter.today = "2026-10-15";
		expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([3]);
		filter.toggleDue("upcoming");
		expect(filter.filterItems(items)).toEqual([]);
		filter.toggleDue("none");
		expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([5]);
		filter.toggleDue("invalid");
		expect(filter.invalidDueCount).toBe(1);
		expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([4]);
		filter.toggleProject("Other");
		expect(filter.filterItems(items)).toEqual([]);
		filter.clear();
		expect(filter.selectedDue).toBeNull();
		expect(filter.filterItems(items)).toHaveLength(5);
		filter.toggleDue("today");
		filter.sync("personal", items);
		expect(filter.selectedDue).toBeNull();
	});
	it.each(["overdue", "today", "upcoming", "none", "invalid"] as const)(
		"applies %s only to open items and clears it in Completed",
		(category) => {
			const due = {
				overdue: "2026-10-13",
				today: "2026-10-14",
				upcoming: "2026-10-15",
				none: undefined,
				invalid: "2026-02-30",
			}[category];
			const datedOpen: TodoItem = { ...open, metadata: due ? { due } : {} };
			const datedCompleted = { ...completed, metadata: datedOpen.metadata };
			const items = [datedOpen, datedCompleted];
			const filter = new TodoFilterState();
			filter.sync("work", items);
			filter.today = "2026-10-14";
			filter.toggleDue(category);
			expect(filter.filterItems(items)).toEqual([datedOpen]);
			expect(filter.filterItems([{ ...datedOpen, completed: true }, datedCompleted])).toEqual([]);
			filter.setStatus("completed");
			expect(filter.selectedDue).toBeNull();
			filter.toggleDue(category);
			expect(filter.selectedDue).toBeNull();
			expect(filter.hasFilters).toBe(false);
			expect(filter.filterItems(items)).toEqual([datedCompleted]);
			filter.setStatus("all");
			expect(filter.filterItems(items)).toEqual(items);
			filter.toggleDue(category);
			expect(filter.filterItems([{ ...datedCompleted, completed: false }])).toEqual([
				{ ...datedCompleted, completed: false },
			]);
		}
	);
	it("clears the repair filter when the last invalid open Due date is repaired or completed", () => {
		const invalid = { ...open, metadata: { due: "broken" } };
		const filter = new TodoFilterState();
		filter.sync("work", [invalid, { ...completed, metadata: invalid.metadata }]);
		expect(filter.invalidDueCount).toBe(1);
		filter.toggleDue("invalid");
		filter.sync("work", [{ ...invalid, metadata: { due: "2026-10-14" } }]);
		expect(filter.invalidDueCount).toBe(0);
		expect(filter.selectedDue).toBeNull();
		filter.sync("work", [invalid]);
		filter.toggleDue("invalid");
		filter.sync("work", [{ ...invalid, completed: true }]);
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

it("saved views retain absent facets across reloads and resolve Today against the current calendar", () => {
	const filter = new TodoFilterState();
	filter.sync("work", [open]);
	filter.applyView({
		status: "open",
		search: "Open",
		project: "Work",
		context: "Home",
		priority: "A",
		due: "today",
	});
	const dueItem = { ...open, metadata: { due: "2026-10-14" } };
	filter.today = "2026-10-14";
	filter.sync("work", [dueItem]);
	expect(filter.filterItems([dueItem])).toEqual([dueItem]);
	filter.today = "2026-10-15";
	expect(filter.filterItems([dueItem])).toEqual([]);
	filter.sync("work", [{ ...dueItem, projects: ["Other"], contexts: ["Elsewhere"] }]);
	expect(filter.snapshot()).toEqual({
		status: "open",
		search: "Open",
		project: "Work",
		context: "Home",
		priority: "A",
		due: "today",
	});
	expect(filter.filterItems([dueItem])).toEqual([]);
	filter.sync("another", [dueItem]);
	expect(filter.snapshot()).toEqual({
		status: "all",
		search: "",
		project: null,
		context: null,
		priority: null,
		due: null,
	});
});

it("hides only future open thresholds and reveals them in the existing sort order", () => {
	const items: TodoItem[] = [
		{ ...open, line_number: 1, metadata: { t: "2026-10-15", due: "2026-10-01" } },
		{ ...open, line_number: 2, metadata: { t: "2026-10-14" } },
		{ ...open, line_number: 3, metadata: { t: "2026-10-13" } },
		{ ...open, line_number: 4, metadata: { t: "2026-02-30" } },
		{ ...open, line_number: 5, metadata: { t: "+2d" } },
		{ ...open, line_number: 6 },
		{ ...completed, line_number: 7, metadata: { t: "2026-10-15" } },
	];
	const filter = new TodoFilterState();
	filter.sync("work", items);
	filter.today = "2026-10-14";
	expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([2, 3, 4, 5, 6, 7]);
	expect(filter.deferredCount).toBe(1);
	filter.showDeferred = true;
	filter.sortOrder = "due";
	expect(filter.filterItems(items).map((item) => item.line_number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
	filter.setStatus("completed");
	expect(filter.deferredCount).toBe(0);
	expect(filter.filterItems(items)).toEqual([items[6]]);
	filter.setStatus("all");
	expect(filter.showDeferred).toBe(true);
	filter.clear();
	expect(filter.showDeferred).toBe(true);
	expect(filter.hasFilters).toBe(false);
	filter.showDeferred = false;
	filter.today = "2026-10-15";
	expect(filter.filterItems(items)).toEqual(items);
	filter.today = "2026-10-16";
	expect(filter.deferredCount).toBe(0);
	filter.showDeferred = true;
	filter.sync("personal", items);
	expect(filter.showDeferred).toBe(false);
	filter.today = "2026-10-14";
	const reopened = { ...items[6], completed: false };
	filter.sync("personal", [reopened]);
	expect(filter.filterItems([reopened])).toEqual([]);
});

it("counts deferred matches before threshold exclusion while preserving completion-view facets", () => {
	const deferred = { ...open, metadata: { t: "2026-10-16", due: "2026-10-13" } };
	const items = [
		deferred,
		{ ...open, line_number: 2, projects: ["Other"], contexts: ["Away"], priority: "B" },
		completed,
	];
	const filter = new TodoFilterState();
	filter.sync("work", items);
	filter.today = "2026-10-14";
	filter.setStatus("open");
	filter.searchText = "open";
	filter.toggleProject("Work");
	filter.toggleContext("Home");
	filter.togglePriority("A");
	filter.toggleDue("overdue");
	expect(filter.deferredCount).toBe(1);
	expect(filter.filterItems(items)).toEqual([]);
	expect(filter.availableFacets.counts.projects.get("Work")).toBe(1);
	expect(filter.availableFacets.counts.contexts.get("Home")).toBe(1);
	expect(filter.availableFacets.counts.priorities.get("A")).toBe(1);
	filter.showDeferred = true;
	expect(filter.filterItems(items)).toEqual([deferred]);
	for (const change of [
		() => {
			filter.searchText = "missing";
		},
		() => {
			filter.selectedProject = "Other";
		},
		() => {
			filter.selectedContext = "Away";
		},
		() => {
			filter.selectedPriority = "B";
		},
		() => {
			filter.selectedDue = "today";
		},
	]) {
		filter.clear();
		change();
		expect(filter.deferredCount).toBe(0);
	}
});

it("syncs Workspace visibility independently of clearing filters and applying saved views", () => {
	const filter = new TodoFilterState();
	filter.sync("work", [open], "file", true);
	expect(filter.showDeferred).toBe(true);
	expect(filter.hasFilters).toBe(false);
	filter.searchText = "open";
	filter.clear();
	expect(filter.showDeferred).toBe(true);
	filter.applyView({
		status: "open",
		search: "",
		project: null,
		context: null,
		priority: null,
		due: null,
	});
	expect(filter.showDeferred).toBe(true);
	filter.sync("personal", [open], "file", false);
	expect(filter.showDeferred).toBe(false);
	filter.sync("work", [open], "due", true);
	expect(filter.showDeferred).toBe(true);
});
