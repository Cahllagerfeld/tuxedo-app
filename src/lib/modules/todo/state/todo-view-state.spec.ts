import type { TodoFile } from "$lib/modules/todo/domain/todo";
import {
	InMemoryWorkspaceLifecycleAdapter,
	WorkspaceState,
} from "$lib/modules/workspace/state/workspace-state.svelte";
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

const workspace = {
	id: "550e8400-e29b-41d4-a716-446655440000",
	name: "Work",
	color: "blue" as const,
	todo_path: "/tmp/todo.txt",
	created_at: "2026-07-10T10:00:00+00:00",
};

function snapshot(todo_file: typeof todoFile) {
	return {
		catalogue: { version: 1 as const, active_workspace_id: workspace.id, workspaces: [workspace] },
		todo_file,
		warning: null,
	};
}

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

	it("derives items, skipped lines, counts, and sorted facets from a loaded Todo file", async () => {
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({ restore: snapshot(todoFile) })
		);
		const view = new TodoViewState(workspaceState);
		await workspaceState.restore();

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

	it("reacts when the loaded Todo file is replaced", async () => {
		const emptyTodo = { path: workspace.todo_path, items: [], skipped: [] };
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: snapshot(todoFile),
				switchWorkspace: snapshot(emptyTodo),
			})
		);
		const view = new TodoViewState(workspaceState);
		await workspaceState.restore();
		expect(view.totalCount).toBe(4);
		await workspaceState.open(workspace.id);

		expect(view.items).toEqual([]);
		expect(view.totalCount).toBe(0);
		expect(view.openCount).toBe(0);
		expect(view.completedCount).toBe(0);
		expect(view.priorityCount).toBe(0);
		expect(view.projectCount).toBe(0);
		expect(view.availableProjects).toEqual([]);
	});
});
