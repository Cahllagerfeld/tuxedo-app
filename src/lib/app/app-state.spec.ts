import type { TodoFile } from "$lib/modules/todo/domain/todo";
import {
	InMemoryWorkspaceLifecycleAdapter,
	WorkspaceState,
} from "$lib/modules/workspace/state/workspace-state.svelte";
import { describe, expect, it } from "vitest";
import { AppState } from "./app-state.svelte";

const workspace = {
	id: "550e8400-e29b-41d4-a716-446655440000",
	name: "Work",
	color: "blue" as const,
	todo_path: "/tmp/todo.txt",
	created_at: "2026-07-10T10:00:00+00:00",
};

function todoFile(items: TodoFile["items"]): TodoFile {
	return { path: workspace.todo_path, items, skipped: [] };
}

function snapshot(todo_file: TodoFile) {
	return {
		status: "active_workspace_loaded" as const,
		catalogue: { version: 1 as const, active_workspace_id: workspace.id, workspaces: [workspace] },
		todo_file,
	};
}

describe("AppState", () => {
	it("refreshes its Todo-file summary from a confirmed completion response", async () => {
		const openItem = {
			line_number: 1,
			raw: "Plan release",
			completed: false,
			priority: null,
			creation_date: null,
			completion_date: null,
			description: "Plan release",
			projects: [],
			contexts: [],
			metadata: {},
		};
		const initialFile = todoFile([openItem]);
		const completedFile = todoFile([
			{
				...openItem,
				raw: "x 2026-07-18 Plan release",
				completed: true,
				completion_date: "2026-07-18",
			},
		]);
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({ restore: snapshot(initialFile) })
		);
		const appState = new AppState(workspaceState, {
			setTodoItemCompletion: async () => completedFile,
			deleteTodoItem: async () => {
				throw new Error("delete is not used in this test");
			},
			createTodoItem: async () => {
				throw new Error("create is not used in this test");
			},
		});
		await workspaceState.restore();

		await appState.todo.setCompletion(openItem);

		expect(appState.todos.counts).toMatchObject({ open: 0, completed: 1 });
		expect(appState.todos.items[0].completion_date).toBe("2026-07-18");
	});

	it("replaces every Todo-file summary fact when the loaded Todo file changes", async () => {
		const initialFile = todoFile([
			{
				line_number: 1,
				raw: "(A) Plan release +Tuxedo @computer",
				completed: false,
				priority: "A",
				creation_date: null,
				completion_date: null,
				description: "Plan release",
				projects: ["Tuxedo"],
				contexts: ["computer"],
				metadata: {},
			},
		]);
		const replacementFile = todoFile([]);
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: snapshot(initialFile),
				switchWorkspace: snapshot(replacementFile),
			})
		);
		const appState = new AppState(workspaceState);

		await workspaceState.restore();
		expect(appState.todos).toMatchObject({
			items: initialFile.items,
			counts: { total: 1, open: 1, priority: 1, projects: 1 },
			facets: { projects: ["Tuxedo"], contexts: ["computer"], priorities: ["A"] },
		});

		await workspaceState.open(workspace.id);
		expect(appState.todos).toEqual({
			items: [],
			skipped: [],
			counts: { total: 0, open: 0, completed: 0, priority: 0, projects: 0, skipped: 0 },
			facets: { projects: [], contexts: [], priorities: [] },
		});
	});
});
