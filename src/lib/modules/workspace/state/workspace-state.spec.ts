import { describe, expect, it } from "vitest";
import { InMemoryWorkspaceLifecycleAdapter, WorkspaceState } from "./workspace-state.svelte";

const work = {
	id: "550e8400-e29b-41d4-a716-446655440000",
	name: "Work",
	color: "blue" as const,
	todo_path: "/tmp/work.todo",
	created_at: "2026-07-10T10:00:00+00:00",
};
const personal = { ...work, id: "550e8400-e29b-41d4-a716-446655440001", name: "Personal" };
const workTodo = { path: work.todo_path, items: [], skipped: [] };
const workSnapshot = {
	catalogue: { version: 1, active_workspace_id: work.id, workspaces: [work, personal] },
	todo_file: workTodo,
	warning: null,
};

describe("WorkspaceState at the lifecycle adapter seam", () => {
	it("restores an Empty session when no active Workspace is saved", async () => {
		const state = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: {
					catalogue: { version: 1, active_workspace_id: null, workspaces: [] },
					todo_file: null,
					warning: null,
				},
			})
		);

		await state.restore();

		expect(state.session).toMatchObject({ status: "empty", catalogue: { workspaces: [] } });
	});

	it("restores the saved active Workspace and its Todo file as one Ready session", async () => {
		const state = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({ restore: workSnapshot })
		);

		await state.restore();

		expect(state.session).toMatchObject({
			status: "ready",
			catalogue: workSnapshot.catalogue,
			todoFile: workTodo,
		});
	});

	it("keeps the catalogue but enters Empty with a warning when the saved Todo file cannot open", async () => {
		const state = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: {
					catalogue: workSnapshot.catalogue,
					todo_file: null,
					warning: "Todo file does not exist",
				},
			})
		);

		await state.restore();

		expect(state.session).toMatchObject({
			status: "empty",
			catalogue: workSnapshot.catalogue,
			warning: "Todo file does not exist",
		});
	});

	it("leaves the session unavailable when restoration cannot read a trustworthy catalogue", async () => {
		const state = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: new Error("failed to parse workspace catalogue"),
			})
		);

		await state.restore();

		expect(state.session).toMatchObject({
			status: "unavailable",
			error: "failed to parse workspace catalogue",
		});
	});

	it("applies a creation snapshot atomically", async () => {
		const created = { ...work, id: "550e8400-e29b-41d4-a716-446655440002", name: "New" };
		const createdTodo = { path: created.todo_path, items: [], skipped: [] };
		const state = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				create: {
					catalogue: { version: 1, active_workspace_id: created.id, workspaces: [created] },
					todo_file: createdTodo,
					warning: null,
				},
			})
		);

		await state.create({ name: "New", color: "blue", todoPath: created.todo_path });

		expect(state.session).toMatchObject({
			status: "ready",
			catalogue: { active_workspace_id: created.id },
			todoFile: createdTodo,
		});
	});

	it("keeps a Ready session intact and clears its error notice when the next operation starts", async () => {
		const adapter = new InMemoryWorkspaceLifecycleAdapter({
			restore: workSnapshot,
			switchWorkspace: new Error("Todo file does not exist"),
			deleteWorkspace: { version: 1, active_workspace_id: work.id, workspaces: [work] },
		});
		const state = new WorkspaceState(adapter);
		await state.restore();

		await state.open(personal.id);
		expect(state.session).toMatchObject({ status: "ready", todoFile: workTodo });
		expect(state.notice).toMatchObject({ kind: "error" });

		await state.delete(personal.id);
		expect(state.notice).toBeNull();
		expect(state.session).toMatchObject({ status: "ready", todoFile: workTodo });
	});

	it("keeps Todo data when deleting a non-active Workspace and enters Empty when deleting the active one", async () => {
		const state = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: workSnapshot,
				deleteWorkspace: ({ workspaceId }: { workspaceId: string }) =>
					workspaceId === personal.id
						? { version: 1, active_workspace_id: work.id, workspaces: [work] }
						: { version: 1, active_workspace_id: null, workspaces: [personal] },
			})
		);
		await state.restore();

		await state.delete(personal.id);
		expect(state.session).toMatchObject({ status: "ready", todoFile: workTodo });
		await state.delete(work.id);
		expect(state.session).toMatchObject({
			status: "empty",
			catalogue: { active_workspace_id: null },
		});
	});

	it("rejects a competing lifecycle operation without allowing it to overwrite the in-flight result", async () => {
		let releaseRestore!: () => void;
		const pendingRestore = new Promise((resolve) => (releaseRestore = () => resolve(workSnapshot)));
		const state = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({ restore: pendingRestore, create: workSnapshot })
		);

		const restoration = state.restore();
		await expect(
			state.create({ name: "Work", color: "blue", todoPath: work.todo_path })
		).rejects.toThrow(/already running/);
		releaseRestore();
		await restoration;

		expect(state.session).toMatchObject({ status: "ready", todoFile: workTodo });
	});

	it("does not apply an invalid Rust snapshot", async () => {
		const state = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: { ...workSnapshot, todo_file: { path: 4 } },
			})
		);

		await state.restore();

		expect(state.session.status).toBe("unavailable");
	});

	it("does not treat an active Workspace without a Todo file or warning as an Empty session", async () => {
		const state = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: { catalogue: workSnapshot.catalogue, todo_file: null, warning: null },
			})
		);

		await state.restore();

		expect(state.session.status).toBe("unavailable");
	});

	it("rejects a deletion response that would retain a Todo file for a changed active path", async () => {
		const state = new WorkspaceState(
			new InMemoryWorkspaceLifecycleAdapter({
				restore: workSnapshot,
				deleteWorkspace: {
					version: 1,
					active_workspace_id: work.id,
					workspaces: [{ ...work, todo_path: "/tmp/replaced.todo" }],
				},
			})
		);
		await state.restore();

		await state.delete(personal.id);

		expect(state.session).toMatchObject({ status: "ready", todoFile: workTodo });
		expect(state.notice).toMatchObject({ kind: "error" });
	});
});
