import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import {
	WorkspaceState,
	type WorkspaceLifecycleAdapter,
} from "$lib/modules/workspace/state/workspace-state.svelte";
import WorkspaceContent from "./WorkspaceContent.svelte";
import { Toaster } from "$lib/shared/ui/sonner";
import { TodoState, type TodoMutationAdapter } from "$lib/modules/todo/state/todo-state.svelte";

const workspace = {
	id: "550e8400-e29b-41d4-a716-446655440000",
	name: "Work",
	color: "blue" as const,
	todo_path: "/tmp/work.todo",
	created_at: "2026-07-10T10:00:00+00:00",
};

const todoFile = {
	path: workspace.todo_path,
	skipped: [],
	items: [
		{
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
		},
	],
};

function renderContent(
	workspaceState: WorkspaceState,
	todoState = new TodoState(workspaceState, {
		setTodoItemCompletion: vi.fn(),
		deleteTodoItem: vi.fn(),
	})
) {
	render(Toaster);
	return render(WorkspaceContent, {
		workspace: workspaceState,
		todoState,
		openWorkspaceCreationDialog: vi.fn(),
	});
}

describe("WorkspaceContent", () => {
	it("persists completion before showing the Todo item as completed", async () => {
		let finishMutation: (value: unknown) => void = () => {};
		const setTodoItemCompletion = vi.fn(
			() =>
				new Promise<unknown>((resolve) => {
					finishMutation = resolve;
				})
		);
		const adapter = {
			restore: vi.fn(),
			create: vi.fn(),
			switchWorkspace: vi.fn(),
			deleteWorkspace: vi.fn(),
		} satisfies WorkspaceLifecycleAdapter;
		const workspaceState = new WorkspaceState(adapter);
		const todoState = new TodoState(workspaceState, {
			setTodoItemCompletion,
			deleteTodoItem: vi.fn(),
		} satisfies TodoMutationAdapter);
		const twoItemTodoFile = {
			...todoFile,
			items: [
				...todoFile.items,
				{
					...todoFile.items[0],
					line_number: 2,
					raw: "Ship release",
					description: "Ship release",
				},
			],
		};
		workspaceState.session = {
			status: "ready",
			catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
			todoFile: twoItemTodoFile,
		};
		renderContent(workspaceState, todoState);

		const checkbox = page.getByRole("checkbox", { name: "Mark Plan release complete" });
		await expect.element(checkbox).not.toBeChecked();
		await checkbox.click();
		await expect.element(checkbox).toBeDisabled();
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Ship release complete" }))
			.toBeDisabled();
		await expect.element(checkbox).not.toBeChecked();
		expect(setTodoItemCompletion).toHaveBeenCalledWith({
			lineNumber: 1,
			expectedRaw: "Plan release",
			completed: true,
		});

		finishMutation({
			...twoItemTodoFile,
			items: [
				{
					...todoFile.items[0],
					raw: "x 2026-07-18 Plan release",
					completed: true,
					completion_date: "2026-07-18",
				},
				twoItemTodoFile.items[1],
			],
		});
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Plan release incomplete" }))
			.toBeChecked();
		await expect.element(page.getByText("Completed 2026-07-18")).toBeVisible();
		expect(document.querySelector("[data-sonner-toast]")).toBeNull();
		expect(document.querySelector(".animate-spin")).toBeNull();
	});

	it("keeps confirmed state and shows a destructive toast when persistence fails", async () => {
		const workspaceState = new WorkspaceState();
		const todoState = new TodoState(workspaceState, {
			setTodoItemCompletion: vi.fn().mockRejectedValue(new Error("permission denied")),
			deleteTodoItem: vi.fn(),
		} satisfies TodoMutationAdapter);
		workspaceState.session = {
			status: "ready",
			catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
			todoFile,
		};
		renderContent(workspaceState, todoState);

		const checkbox = page.getByRole("checkbox", { name: "Mark Plan release complete" });
		await checkbox.click();

		await expect.element(checkbox).not.toBeChecked();
		await expect.element(checkbox).toBeEnabled();
		await expect.element(page.getByText("Could not update Todo item")).toBeVisible();
		await expect.element(page.getByText("permission denied")).toBeVisible();
	});

	it("reloads the Todo file and reports an external-edit conflict", async () => {
		const externallyEditedTodoFile = {
			...todoFile,
			items: [
				{
					...todoFile.items[0],
					raw: "Plan release carefully",
					description: "Plan release carefully",
				},
			],
		};
		const adapter = {
			restore: vi.fn().mockResolvedValue({
				status: "active_workspace_loaded",
				catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
				todo_file: externallyEditedTodoFile,
			}),
			create: vi.fn(),
			switchWorkspace: vi.fn(),
			deleteWorkspace: vi.fn(),
		} satisfies WorkspaceLifecycleAdapter;
		const todoAdapter = {
			setTodoItemCompletion: vi
				.fn()
				.mockRejectedValue({ kind: "conflict", message: "Todo item changed externally" }),
			deleteTodoItem: vi.fn(),
		} satisfies TodoMutationAdapter;
		const workspaceState = new WorkspaceState(adapter);
		const todoState = new TodoState(workspaceState, todoAdapter);
		workspaceState.session = {
			status: "ready",
			catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
			todoFile,
		};
		renderContent(workspaceState, todoState);

		await page.getByRole("checkbox", { name: "Mark Plan release complete" }).click();

		await expect.element(page.getByText("Plan release carefully")).toBeVisible();
		await expect
			.element(page.getByText("Todo file changed externally; reloaded latest version"))
			.toBeVisible();
		expect(adapter.restore).toHaveBeenCalledOnce();
	});

	it("renders loading as a non-actionable Workspace state", async () => {
		renderContent(new WorkspaceState());

		await expect.element(page.getByLabelText("Loading workspace session")).toBeVisible();
		await expect.element(page.getByText("Loading workspaces…")).toBeVisible();
		await expect.element(page.getByRole("button")).not.toBeInTheDocument();
	});

	it("replaces stale content with an unavailable Workspace catalogue notice", async () => {
		const workspaceState = new WorkspaceState();
		workspaceState.session = { status: "unavailable", error: "Workspace catalogue is unavailable" };

		renderContent(workspaceState);

		await expect
			.element(page.getByRole("alert"))
			.toHaveTextContent("Workspace catalogue is unavailable");
		await expect.element(page.getByText("No workspace open")).not.toBeInTheDocument();
		await expect.element(page.getByRole("button")).not.toBeInTheDocument();
	});

	it("offers one New Workspace action and a restoration warning when no Todo file is open", async () => {
		const workspaceState = new WorkspaceState();
		workspaceState.session = {
			status: "empty",
			catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
			warning: "Could not open /tmp/work.todo",
		};

		renderContent(workspaceState);

		await expect.element(page.getByLabelText("No active workspace")).toBeVisible();
		expect(page.getByRole("button", { name: "New workspace" }).length).toBe(1);
		await expect
			.element(page.getByRole("status"))
			.toHaveTextContent("Could not open /tmp/work.todo");
	});

	it("keeps ready Todo content visible beside an operation error", async () => {
		const workspaceState = new WorkspaceState();
		workspaceState.session = {
			status: "ready",
			catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
			todoFile,
		};
		workspaceState.notice = {
			kind: "error",
			message: "Could not delete workspace: permission denied",
		};

		renderContent(workspaceState);

		await expect
			.element(page.getByRole("alert"))
			.toHaveTextContent("Could not delete workspace: permission denied");
		await expect.element(page.getByRole("list", { name: "Todo items" })).toBeVisible();
		await expect.element(page.getByText("Plan release")).toBeVisible();
	});

	it("disables its New Workspace action while another Workspace lifecycle operation runs", async () => {
		const workspaceState = new WorkspaceState();
		workspaceState.session = {
			status: "empty",
			catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
			warning: null,
		};
		workspaceState.isOperating = true;

		renderContent(workspaceState);

		await expect.element(page.getByRole("button", { name: "New workspace" })).toBeDisabled();
	});

	it("persists Todo item deletion and removes the item without a success toast", async () => {
		let finishMutation: (value: unknown) => void = () => {};
		const deleteTodoItem = vi.fn(
			() =>
				new Promise<unknown>((resolve) => {
					finishMutation = resolve;
				})
		);
		const workspaceState = new WorkspaceState();
		const todoState = new TodoState(workspaceState, {
			setTodoItemCompletion: vi.fn(),
			deleteTodoItem,
		} satisfies TodoMutationAdapter);
		const twoItemTodoFile = {
			...todoFile,
			items: [
				...todoFile.items,
				{
					...todoFile.items[0],
					line_number: 2,
					raw: "Ship release",
					description: "Ship release",
				},
			],
		};
		workspaceState.session = {
			status: "ready",
			catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
			todoFile: twoItemTodoFile,
		};
		renderContent(workspaceState, todoState);

		const deleteButton = page.getByRole("button", { name: "Delete Plan release" });
		await deleteButton.click();
		await expect.element(deleteButton).toBeDisabled();
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Plan release complete" }))
			.toBeDisabled();
		await expect.element(page.getByText("Plan release")).toBeVisible();
		expect(deleteTodoItem).toHaveBeenCalledWith({
			lineNumber: 1,
			expectedRaw: "Plan release",
		});

		finishMutation({
			...twoItemTodoFile,
			items: [twoItemTodoFile.items[1]],
		});
		await expect.element(page.getByText("Plan release")).not.toBeInTheDocument();
		await expect.element(page.getByText("Ship release")).toBeVisible();
		expect(document.querySelector("[data-sonner-toast]")).toBeNull();
	});

	it("keeps the Todo item and shows a destructive toast when deletion fails", async () => {
		const workspaceState = new WorkspaceState();
		const todoState = new TodoState(workspaceState, {
			setTodoItemCompletion: vi.fn(),
			deleteTodoItem: vi.fn().mockRejectedValue(new Error("permission denied")),
		} satisfies TodoMutationAdapter);
		workspaceState.session = {
			status: "ready",
			catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
			todoFile,
		};
		renderContent(workspaceState, todoState);

		await page.getByRole("button", { name: "Delete Plan release" }).click();

		await expect.element(page.getByText("Plan release")).toBeVisible();
		await expect.element(page.getByText("Could not delete Todo item")).toBeVisible();
		await expect.element(page.getByText("permission denied")).toBeVisible();
	});

	it("reloads the Todo file and reports an external-edit conflict on delete", async () => {
		const externallyEditedTodoFile = {
			...todoFile,
			items: [
				{
					...todoFile.items[0],
					raw: "Plan release carefully",
					description: "Plan release carefully",
				},
			],
		};
		const adapter = {
			restore: vi.fn().mockResolvedValue({
				status: "active_workspace_loaded",
				catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
				todo_file: externallyEditedTodoFile,
			}),
			create: vi.fn(),
			switchWorkspace: vi.fn(),
			deleteWorkspace: vi.fn(),
		} satisfies WorkspaceLifecycleAdapter;
		const todoAdapter = {
			setTodoItemCompletion: vi.fn(),
			deleteTodoItem: vi
				.fn()
				.mockRejectedValue({ kind: "conflict", message: "Todo item changed externally" }),
		} satisfies TodoMutationAdapter;
		const workspaceState = new WorkspaceState(adapter);
		const todoState = new TodoState(workspaceState, todoAdapter);
		workspaceState.session = {
			status: "ready",
			catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
			todoFile,
		};
		renderContent(workspaceState, todoState);

		await page.getByRole("button", { name: "Delete Plan release" }).click();

		await expect.element(page.getByText("Plan release carefully")).toBeVisible();
		await expect
			.element(page.getByText("Todo file changed externally; reloaded latest version"))
			.toBeVisible();
		expect(adapter.restore).toHaveBeenCalledOnce();
	});
});
