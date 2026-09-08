import { describe, expect, it, vi } from "vitest";
import type { WorkspaceSessionOperationOutcome } from "../domain/workspace";
import {
	InMemoryWorkspaceSessionAdapter,
	WorkspaceSessionState,
} from "./workspace-session-state.svelte";

const workspace = {
	id: "550e8400-e29b-41d4-a716-446655440000",
	name: "Work",
	color: "blue" as const,
	todo_path: "/tmp/work.todo",
	created_at: "2026-07-10T10:00:00+00:00",
};
const todo = {
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
const snapshot = {
	status: "active_workspace_loaded" as const,
	catalogue: { version: 1 as const, active_workspace_id: workspace.id, workspaces: [workspace] },
	todo_file: { path: workspace.todo_path, items: [todo], skipped: [] },
};
const applied = (next = snapshot): WorkspaceSessionOperationOutcome => ({
	outcome: "applied",
	snapshot: next,
});

describe("WorkspaceSessionState", () => {
	it("exposes a recursively read-only session projection", () => {
		const state = new WorkspaceSessionState(new InMemoryWorkspaceSessionAdapter({}));

		// @ts-expect-error Workspace session projections cannot be mutated by renderer consumers.
		state.catalogue?.workspaces.push(workspace);
		// @ts-expect-error Todo file projections cannot be mutated by renderer consumers.
		state.todoFile?.items.push(todo);
		expect(state.session.status).toBe("loading");
	});

	it("restores one coherent Ready Workspace session", async () => {
		const state = new WorkspaceSessionState(
			new InMemoryWorkspaceSessionAdapter({ restore: snapshot })
		);

		await state.restore();

		expect(state.session).toMatchObject({
			status: "ready",
			catalogue: snapshot.catalogue,
			todoFile: snapshot.todo_file,
		});
		expect(state.pendingOperation).toBeNull();
		expect(Object.isFrozen(state.session)).toBe(true);
		expect(Object.isFrozen(state.catalogue)).toBe(true);
		expect(Object.isFrozen(state.catalogue?.workspaces)).toBe(true);
		expect(Object.isFrozen(state.todoFile?.items)).toBe(true);
	});

	it("rejects an overlapping Workspace session operation", async () => {
		let finishMutation!: (outcome: WorkspaceSessionOperationOutcome) => void;
		const switchWorkspace = vi.fn();
		const state = new WorkspaceSessionState(
			new InMemoryWorkspaceSessionAdapter({
				restore: snapshot,
				setTodoItemCompletion: new Promise((resolve) => {
					finishMutation = resolve;
				}),
				switchWorkspace,
			})
		);
		await state.restore();

		const mutation = state.setCompletion(todo);
		expect(state.pendingOperation).toBe("set_todo_item_completion");
		await expect(state.open(workspace.id)).rejects.toThrow(
			/set_todo_item_completion is already running/
		);
		expect(switchWorkspace).not.toHaveBeenCalled();

		finishMutation(applied());
		await mutation;
		expect(state.pendingOperation).toBeNull();
	});

	it("applies the latest coherent snapshot returned by a conflict", async () => {
		const latest = {
			...snapshot,
			todo_file: {
				...snapshot.todo_file,
				items: [{ ...todo, raw: "Plan release carefully", description: "Plan release carefully" }],
			},
		};
		const state = new WorkspaceSessionState(
			new InMemoryWorkspaceSessionAdapter({
				restore: snapshot,
				setTodoItemCompletion: {
					outcome: "conflict",
					message: "Todo item changed externally",
					snapshot: latest,
				},
			})
		);
		await state.restore();

		const result = await state.setCompletion(todo);

		expect(result).toEqual({ status: "conflict", message: "Todo item changed externally" });
		expect(state.todoFile?.items[0].description).toBe("Plan release carefully");
	});

	it("preserves the current Workspace session when an operation is rejected", async () => {
		const state = new WorkspaceSessionState(
			new InMemoryWorkspaceSessionAdapter({
				restore: snapshot,
				deleteWorkspace: { outcome: "rejected", message: "permission denied" },
			})
		);
		await state.restore();

		const result = await state.deleteWorkspace(workspace.id);

		expect(result).toEqual({ status: "rejected", message: "permission denied" });
		expect(state.session).toMatchObject({ status: "ready", todoFile: snapshot.todo_file });
	});

	it("turns an unexpected restoration failure into an Unavailable session", async () => {
		const state = new WorkspaceSessionState(
			new InMemoryWorkspaceSessionAdapter({ restore: new Error("invalid catalogue") })
		);

		await state.restore();

		expect(state.session).toEqual({ status: "unavailable", error: "invalid catalogue" });
	});
});
