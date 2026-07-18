import type { TodoFile } from "$lib/modules/todo/domain/todo";
import { InMemoryTodoFileObservationAdapter } from "$lib/modules/todo/state/todo-file-observation";
import {
	InMemoryWorkspaceLifecycleAdapter,
	WorkspaceState,
} from "$lib/modules/workspace/state/workspace-state.svelte";
import { describe, expect, it, vi } from "vitest";
import { AppState, UNREADABLE_TODO_FILE_DEBOUNCE_MS } from "./app-state.svelte";

const workspace = {
	id: "550e8400-e29b-41d4-a716-446655440000",
	name: "Work",
	color: "blue" as const,
	todo_path: "/tmp/todo.txt",
	created_at: "2026-07-10T10:00:00+00:00",
};

const personal = {
	...workspace,
	id: "550e8400-e29b-41d4-a716-446655440001",
	name: "Personal",
	todo_path: "/tmp/personal.todo",
};

function todoItem(overrides: Partial<TodoFile["items"][number]> = {}): TodoFile["items"][number] {
	return {
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
		...overrides,
	};
}

function todoFile(
	path: string,
	items: TodoFile["items"],
	skipped: TodoFile["skipped"] = []
): TodoFile {
	return { path, items, skipped };
}

function loadedSnapshot(
	todo_file: TodoFile,
	options: { workspaces?: (typeof workspace)[]; activeWorkspaceId?: string } = {}
) {
	const workspaces = options.workspaces ?? [workspace];
	const activeWorkspaceId =
		options.activeWorkspaceId ??
		workspaces.find((entry) => entry.todo_path === todo_file.path)?.id ??
		workspaces[0]?.id ??
		workspace.id;
	return {
		status: "active_workspace_loaded" as const,
		catalogue: {
			version: 1 as const,
			active_workspace_id: activeWorkspaceId,
			workspaces,
		},
		todo_file,
	};
}

describe("AppState Todo-file observation", () => {
	it("starts observation on the Active Todo file after a Ready restore", async () => {
		const observation = new InMemoryTodoFileObservationAdapter();
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: loadedSnapshot(todoFile(workspace.todo_path, [todoItem()])),
			})
		);
		const appState = new AppState(workspaceState, undefined, observation);

		await appState.restore();

		expect(observation.observedPath).toBe(workspace.todo_path);
	});

	it("stops observation when restore enters Empty with no loaded Todo file", async () => {
		const observation = new InMemoryTodoFileObservationAdapter();
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: {
					status: "no_active_workspace",
					catalogue: { version: 1, active_workspace_id: null, workspaces: [] },
				},
			})
		);
		const appState = new AppState(workspaceState, undefined, observation);

		await appState.restore();

		expect(observation.observedPath).toBeNull();
	});

	it("retargets observation when switching Workspaces", async () => {
		const observation = new InMemoryTodoFileObservationAdapter();
		const personalFile = todoFile(personal.todo_path, [
			todoItem({ raw: "Buy milk", description: "Buy milk" }),
		]);
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: loadedSnapshot(todoFile(workspace.todo_path, [todoItem()]), {
					workspaces: [workspace, personal],
				}),
				switchWorkspace: loadedSnapshot(personalFile, {
					workspaces: [workspace, personal],
					activeWorkspaceId: personal.id,
				}),
			})
		);
		const appState = new AppState(workspaceState, undefined, observation);
		await appState.restore();

		await appState.open(personal.id);

		expect(observation.observedPath).toBe(personal.todo_path);
	});

	it("stops observation when deleting the Active workspace enters Empty", async () => {
		const observation = new InMemoryTodoFileObservationAdapter();
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: loadedSnapshot(todoFile(workspace.todo_path, [todoItem()])),
				deleteWorkspace: {
					status: "no_active_workspace",
					catalogue: { version: 1, active_workspace_id: null, workspaces: [] },
				},
			})
		);
		const appState = new AppState(workspaceState, undefined, observation);
		await appState.restore();
		expect(observation.observedPath).toBe(workspace.todo_path);

		await appState.delete(workspace.id);

		expect(observation.observedPath).toBeNull();
	});

	it("reloads through the shared restore path when an idle observation signal arrives", async () => {
		const observation = new InMemoryTodoFileObservationAdapter();
		const initial = todoFile(workspace.todo_path, [todoItem()]);
		const updated = todoFile(workspace.todo_path, [
			todoItem({ raw: "Plan release carefully", description: "Plan release carefully" }),
		]);
		let restoreCalls = 0;
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: () => {
					restoreCalls += 1;
					return restoreCalls === 1 ? loadedSnapshot(initial) : loadedSnapshot(updated);
				},
			})
		);
		const appState = new AppState(workspaceState, undefined, observation);
		await appState.restore();

		await observation.emitChangedAsync();

		expect(appState.workspace.todoFile?.items[0]?.description).toBe("Plan release carefully");
		expect(appState.todos.items[0]?.description).toBe("Plan release carefully");
	});

	it("ignores observation signals while a Todo-item mutation is in flight", async () => {
		const observation = new InMemoryTodoFileObservationAdapter();
		const initial = todoFile(workspace.todo_path, [todoItem()]);
		let finishMutation: (value: unknown) => void = () => {};
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: loadedSnapshot(initial),
			})
		);
		const appState = new AppState(
			workspaceState,
			{
				setTodoItemCompletion: () =>
					new Promise((resolve) => {
						finishMutation = resolve;
					}),
			},
			observation
		);
		await appState.restore();
		const restoreDuringBusy = vi.spyOn(workspaceState, "refreshTodoFile");

		const mutation = appState.todo.setCompletion(initial.items[0]!);
		await observation.emitChangedAsync();
		expect(restoreDuringBusy).not.toHaveBeenCalled();

		finishMutation({
			...initial,
			items: [
				{
					...initial.items[0]!,
					raw: "x 2026-07-18 Plan release",
					completed: true,
					completion_date: "2026-07-18",
				},
			],
		});
		await mutation;
	});

	it("ignores observation signals while a Workspace operation is in flight", async () => {
		const observation = new InMemoryTodoFileObservationAdapter();
		let releaseSwitch!: () => void;
		const pendingSwitch = new Promise((resolve) => {
			releaseSwitch = () =>
				resolve(
					loadedSnapshot(todoFile(personal.todo_path, []), {
						workspaces: [workspace, personal],
						activeWorkspaceId: personal.id,
					})
				);
		});
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: loadedSnapshot(todoFile(workspace.todo_path, [todoItem()]), {
					workspaces: [workspace, personal],
				}),
				switchWorkspace: pendingSwitch,
			})
		);
		const appState = new AppState(workspaceState, undefined, observation);
		await appState.restore();
		const refresh = vi.spyOn(workspaceState, "refreshTodoFile");

		const switching = appState.open(personal.id);
		await observation.emitChangedAsync();
		expect(refresh).not.toHaveBeenCalled();

		releaseSwitch();
		await switching;
	});

	it("notifies only when an observation reload changes the Todo-file summary", async () => {
		const observation = new InMemoryTodoFileObservationAdapter();
		const onSummaryChanged = vi.fn();
		const initial = todoFile(workspace.todo_path, [todoItem()]);
		const updated = todoFile(workspace.todo_path, [
			todoItem({ raw: "Ship it", description: "Ship it" }),
		]);
		let restoreCalls = 0;
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: () => {
					restoreCalls += 1;
					return restoreCalls === 1 ? loadedSnapshot(initial) : loadedSnapshot(updated);
				},
			})
		);
		const appState = new AppState(workspaceState, undefined, observation, {
			onObservationSummaryChanged: onSummaryChanged,
		});
		await appState.restore();

		await observation.emitChangedAsync();

		expect(onSummaryChanged).toHaveBeenCalledOnce();
	});

	it("does not notify when an observation reload leaves the Todo-file summary unchanged", async () => {
		const observation = new InMemoryTodoFileObservationAdapter();
		const onSummaryChanged = vi.fn();
		const file = todoFile(workspace.todo_path, [todoItem()]);
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: loadedSnapshot(file),
			})
		);
		const appState = new AppState(workspaceState, undefined, observation, {
			onObservationSummaryChanged: onSummaryChanged,
		});
		await appState.restore();

		await observation.emitChangedAsync();

		expect(onSummaryChanged).not.toHaveBeenCalled();
	});

	it("enters Empty with a warning when observation finds the Active Todo file stably unreadable", async () => {
		vi.useFakeTimers();
		const observation = new InMemoryTodoFileObservationAdapter();
		const onSummaryChanged = vi.fn();
		const initial = todoFile(workspace.todo_path, [todoItem()]);
		let restoreCalls = 0;
		const unavailable = {
			status: "active_workspace_unavailable" as const,
			catalogue: {
				version: 1 as const,
				active_workspace_id: workspace.id,
				workspaces: [workspace],
			},
			warning: "Saved workspace could not be opened: Todo file does not exist",
		};
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: () => {
					restoreCalls += 1;
					if (restoreCalls === 1) return loadedSnapshot(initial);
					return unavailable;
				},
			})
		);
		const appState = new AppState(workspaceState, undefined, observation, {
			onObservationSummaryChanged: onSummaryChanged,
		});
		await appState.restore();

		const refresh = observation.emitChangedAsync();
		await vi.advanceTimersByTimeAsync(UNREADABLE_TODO_FILE_DEBOUNCE_MS);
		await refresh;

		expect(appState.workspace.session).toMatchObject({
			status: "empty",
			warning: "Saved workspace could not be opened: Todo file does not exist",
		});
		expect(observation.observedPath).toBeNull();
		expect(onSummaryChanged).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("keeps the Ready Todo file when an unreadable observation settles back to readable", async () => {
		vi.useFakeTimers();
		const observation = new InMemoryTodoFileObservationAdapter();
		const initial = todoFile(workspace.todo_path, [todoItem()]);
		let restoreCalls = 0;
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: () => {
					restoreCalls += 1;
					if (restoreCalls === 1) return loadedSnapshot(initial);
					if (restoreCalls === 2) {
						return {
							status: "active_workspace_unavailable" as const,
							catalogue: {
								version: 1 as const,
								active_workspace_id: workspace.id,
								workspaces: [workspace],
							},
							warning: "Saved workspace could not be opened: Todo file does not exist",
						};
					}
					return loadedSnapshot(initial);
				},
			})
		);
		const appState = new AppState(workspaceState, undefined, observation);
		await appState.restore();

		const refresh = observation.emitChangedAsync();
		await vi.advanceTimersByTimeAsync(UNREADABLE_TODO_FILE_DEBOUNCE_MS);
		await refresh;

		expect(appState.workspace.session).toMatchObject({
			status: "ready",
			todoFile: initial,
		});
		expect(observation.observedPath).toBe(workspace.todo_path);
		vi.useRealTimers();
	});

	it("starts observation after creating a Workspace that loads a Todo file", async () => {
		const observation = new InMemoryTodoFileObservationAdapter();
		const created = todoFile(workspace.todo_path, [todoItem()]);
		const workspaceState = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: {
					status: "no_active_workspace",
					catalogue: { version: 1, active_workspace_id: null, workspaces: [] },
				},
				create: loadedSnapshot(created),
			})
		);
		const appState = new AppState(workspaceState, undefined, observation);
		await appState.restore();
		expect(observation.observedPath).toBeNull();

		await appState.create({ name: "Work", color: "blue", todoPath: workspace.todo_path });

		expect(observation.observedPath).toBe(workspace.todo_path);
	});
});
