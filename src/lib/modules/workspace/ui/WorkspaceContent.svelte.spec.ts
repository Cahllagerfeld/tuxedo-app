import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { WorkspaceState } from "$lib/modules/workspace/state/workspace-state.svelte";
import WorkspaceContent from "./WorkspaceContent.svelte";

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

function renderContent(workspaceState: WorkspaceState) {
	return render(WorkspaceContent, {
		workspace: workspaceState,
		openWorkspaceCreationDialog: vi.fn(),
	});
}

describe("WorkspaceContent", () => {
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
});
