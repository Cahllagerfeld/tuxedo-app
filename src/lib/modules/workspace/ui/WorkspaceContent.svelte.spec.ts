import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import {
	InMemoryWorkspaceSessionAdapter,
	WorkspaceSessionState,
	type WorkspaceSessionAdapter,
} from "$lib/modules/workspace/state/workspace-session-state.svelte";
import { Toaster } from "$lib/shared/ui/sonner";
import WorkspaceContent from "./WorkspaceContent.svelte";

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

async function readyState(
	outcomes: ConstructorParameters<typeof InMemoryWorkspaceSessionAdapter>[0] = {}
) {
	const state = new WorkspaceSessionState(
		new InMemoryWorkspaceSessionAdapter({ restore: snapshot, ...outcomes })
	);
	await state.restore();
	return state;
}

function renderContent(workspaceState: WorkspaceSessionState) {
	render(Toaster);
	return render(WorkspaceContent, {
		workspace: workspaceState,
		openWorkspaceCreationDialog: vi.fn(),
	});
}

describe("WorkspaceContent", () => {
	it("renders loading as a non-actionable Workspace session", async () => {
		renderContent(new WorkspaceSessionState());

		await expect.element(page.getByLabelText("Loading workspace session")).toBeVisible();
		await expect.element(page.getByRole("button")).not.toBeInTheDocument();
	});

	it("persists completion before showing the Todo item as completed", async () => {
		let finishMutation!: (
			value: Awaited<ReturnType<WorkspaceSessionAdapter["setTodoItemCompletion"]>>
		) => void;
		const completedSnapshot = {
			...snapshot,
			todo_file: {
				...snapshot.todo_file,
				items: [
					{
						...todo,
						raw: "x 2026-07-18 Plan release",
						completed: true,
						completion_date: "2026-07-18",
					},
				],
			},
		};
		const state = await readyState({
			setTodoItemCompletion: new Promise((resolve) => {
				finishMutation = resolve;
			}),
		});
		renderContent(state);

		const checkbox = page.getByRole("checkbox", { name: "Mark Plan release complete" });
		await checkbox.click();
		await expect.element(checkbox).toBeDisabled();
		await expect.element(checkbox).not.toBeChecked();
		await expect.element(page.getByText("Updating Todo file…")).toBeVisible();

		finishMutation({ outcome: "applied", snapshot: completedSnapshot });
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Plan release incomplete" }))
			.toBeChecked();
	});

	it("applies a conflict snapshot and reports the external edit", async () => {
		const latest = {
			...snapshot,
			todo_file: {
				...snapshot.todo_file,
				items: [{ ...todo, raw: "Plan release carefully", description: "Plan release carefully" }],
			},
		};
		const state = await readyState({
			setTodoItemCompletion: {
				outcome: "conflict",
				message: "Todo item changed externally",
				snapshot: latest,
			},
		});
		renderContent(state);

		await page.getByRole("checkbox", { name: "Mark Plan release complete" }).click();

		await expect.element(page.getByText("Plan release carefully")).toBeVisible();
		await expect
			.element(page.getByText("Todo file changed externally; reloaded latest version"))
			.toBeVisible();
	});

	it("preserves confirmed content and reports a rejected mutation", async () => {
		const state = await readyState({
			deleteTodoItem: { outcome: "rejected", message: "permission denied" },
		});
		renderContent(state);

		await page.getByRole("button", { name: "Delete Plan release" }).click();

		await expect.element(page.getByText("Plan release")).toBeVisible();
		await expect.element(page.getByText("Could not delete Todo item")).toBeVisible();
		await expect.element(page.getByText("permission denied")).toBeVisible();
	});

	it("renders an unavailable Workspace catalogue without actions", async () => {
		const state = new WorkspaceSessionState(
			new InMemoryWorkspaceSessionAdapter({ restore: new Error("invalid catalogue") })
		);
		await state.restore();
		renderContent(state);

		await expect.element(page.getByRole("alert")).toHaveTextContent("invalid catalogue");
		await expect.element(page.getByRole("button")).not.toBeInTheDocument();
	});

	it("renders the Empty state and its restoration warning", async () => {
		const state = new WorkspaceSessionState(
			new InMemoryWorkspaceSessionAdapter({
				restore: {
					status: "active_workspace_unavailable",
					catalogue: snapshot.catalogue,
					warning: "Could not open /tmp/work.todo",
				},
			})
		);
		await state.restore();
		renderContent(state);

		await expect.element(page.getByLabelText("No active workspace")).toBeVisible();
		await expect.element(page.getByText("Could not open /tmp/work.todo")).toBeVisible();
	});

	it("removes a Todo item after a confirmed deletion snapshot", async () => {
		const state = await readyState({
			deleteTodoItem: {
				outcome: "applied",
				snapshot: {
					...snapshot,
					todo_file: { ...snapshot.todo_file, items: [] },
				},
			},
		});
		renderContent(state);

		await page.getByRole("button", { name: "Delete Plan release" }).click();

		await expect.element(page.getByText("Plan release")).not.toBeInTheDocument();
	});
});
