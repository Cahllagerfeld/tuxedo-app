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
	todoState = new TodoState(workspaceState, { setTodoItemCompletion: vi.fn() })
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

		const completedTodoFile = {
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
		};
		adapter.restore.mockResolvedValue({
			status: "active_workspace_loaded",
			catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
			todo_file: completedTodoFile,
		});
		finishMutation(completedTodoFile);
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

	it("shows a quieter info notice when Todo-file observation changes the summary", async () => {
		const observation = new (
			await import("$lib/modules/todo/state/todo-file-observation")
		).InMemoryTodoFileObservationAdapter();
		const initial = todoFile;
		const updated = {
			...todoFile,
			items: [
				{
					...todoFile.items[0],
					raw: "Plan release carefully",
					description: "Plan release carefully",
				},
			],
		};
		let restoreCalls = 0;
		const adapter = {
			restore: vi.fn(async () => {
				restoreCalls += 1;
				return {
					status: "active_workspace_loaded" as const,
					catalogue: {
						version: 1 as const,
						active_workspace_id: workspace.id,
						workspaces: [workspace],
					},
					todo_file: restoreCalls === 1 ? initial : updated,
				};
			}),
			create: vi.fn(),
			switchWorkspace: vi.fn(),
			deleteWorkspace: vi.fn(),
		} satisfies WorkspaceLifecycleAdapter;
		const workspaceState = new WorkspaceState(adapter);
		const { AppState } = await import("$lib/app/app-state.svelte");
		const { showTodoFileObservationNotice } =
			await import("$lib/modules/todo/ui/todo-file-notices");
		const appState = new AppState(workspaceState, undefined, observation, {
			onObservationSummaryChanged: showTodoFileObservationNotice,
		});
		await appState.restore();
		renderContent(workspaceState, appState.todo);

		await observation.emitChanged();

		await expect.element(page.getByText("Plan release carefully")).toBeVisible();
		await expect.element(page.getByText("Todo file updated from disk")).toBeVisible();
		expect(document.querySelector("[data-sonner-toast][data-type='error']")).toBeNull();
	});

	it("does not stack an observation info notice on top of a mutation conflict toast", async () => {
		const observation = new (
			await import("$lib/modules/todo/state/todo-file-observation")
		).InMemoryTodoFileObservationAdapter();
		const initial = todoFile;
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
		let finishMutation: (error: unknown) => void = () => {};
		let restoreCalls = 0;
		const adapter = {
			restore: vi.fn(async () => {
				restoreCalls += 1;
				return {
					status: "active_workspace_loaded" as const,
					catalogue: {
						version: 1 as const,
						active_workspace_id: workspace.id,
						workspaces: [workspace],
					},
					todo_file: restoreCalls === 1 ? initial : externallyEditedTodoFile,
				};
			}),
			create: vi.fn(),
			switchWorkspace: vi.fn(),
			deleteWorkspace: vi.fn(),
		} satisfies WorkspaceLifecycleAdapter;
		const todoAdapter = {
			setTodoItemCompletion: vi.fn(
				() =>
					new Promise((_, reject) => {
						finishMutation = reject;
					})
			),
		} satisfies TodoMutationAdapter;
		const workspaceState = new WorkspaceState(adapter);
		const { AppState } = await import("$lib/app/app-state.svelte");
		const { showTodoFileObservationNotice } =
			await import("$lib/modules/todo/ui/todo-file-notices");
		const appState = new AppState(workspaceState, todoAdapter, observation, {
			onObservationSummaryChanged: showTodoFileObservationNotice,
		});
		await appState.restore();
		renderContent(workspaceState, appState.todo);

		await page.getByRole("checkbox", { name: "Mark Plan release complete" }).click();
		await expect
			.element(page.getByRole("checkbox", { name: "Mark Plan release complete" }))
			.toBeDisabled();
		await observation.emitChanged();
		finishMutation({ kind: "conflict", message: "Todo item changed externally" });

		await expect
			.element(page.getByText("Todo file changed externally; reloaded latest version"))
			.toBeVisible();
		expect(page.getByText("Todo file updated from disk").elements().length).toBe(0);
	});
});
