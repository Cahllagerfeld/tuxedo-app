import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import WorkspaceSwitcher from "./WorkspaceSwitcher.svelte";

const work = {
	id: "550e8400-e29b-41d4-a716-446655440000",
	name: "Work",
	color: "blue" as const,
	todo_path: "/tmp/work.todo",
	created_at: "2026-07-10T10:00:00+00:00",
};
const personal = {
	...work,
	id: "550e8400-e29b-41d4-a716-446655440001",
	name: "Personal",
	color: "green" as const,
	todo_path: "/tmp/personal.todo",
	created_at: "2026-07-11T10:00:00+00:00",
};

describe("WorkspaceSwitcher", () => {
	it("lists workspaces oldest first, identifies the active one, and selects another", async () => {
		const selectWorkspace = vi.fn(async () => {});
		render(WorkspaceSwitcher, {
			workspaces: [personal, work],
			activeWorkspaceId: personal.id,
			selectWorkspace,
			deleteWorkspace: vi.fn(),
			openCreationDialog: vi.fn(),
		});

		await page.getByRole("button", { name: "Select workspace: Personal" }).click();
		const entries = page.getByRole("menuitem");
		await expect.element(entries.nth(0)).toHaveTextContent("Work");
		await expect.element(entries.nth(1)).toHaveTextContent("Personal");
		await expect.element(page.getByRole("menuitem", { name: "Personal, active" })).toBeVisible();

		await page.getByRole("menuitem", { name: "Work", exact: true }).click();
		expect(selectWorkspace).toHaveBeenCalledWith(work.id);
	});

	it("offers an intelligible empty-state entry point", async () => {
		const openCreationDialog = vi.fn();
		render(WorkspaceSwitcher, {
			workspaces: [],
			activeWorkspaceId: null,
			selectWorkspace: vi.fn(),
			deleteWorkspace: vi.fn(),
			openCreationDialog,
		});

		await page.getByRole("button", { name: "Select workspace: No workspace selected" }).click();
		await expect.element(page.getByText("No saved workspaces yet.")).toBeVisible();
		await page.getByRole("menuitem", { name: "New workspace" }).click();
		expect(openCreationDialog).toHaveBeenCalledOnce();
	});

	it("requires confirmation before deleting the active workspace", async () => {
		const deleteWorkspace = vi.fn(async () => {});
		render(WorkspaceSwitcher, {
			workspaces: [work],
			activeWorkspaceId: work.id,
			selectWorkspace: vi.fn(),
			deleteWorkspace,
			openCreationDialog: vi.fn(),
		});

		await page.getByRole("button", { name: "Select workspace: Work" }).click();
		await page.getByRole("menuitem", { name: "Delete Work" }).click();
		await expect.element(page.getByRole("alertdialog")).toBeVisible();
		await expect.element(page.getByText("Delete Workspace?", { exact: true })).toBeVisible();
		expect(deleteWorkspace).not.toHaveBeenCalled();

		await page.getByRole("button", { name: "Cancel" }).click();
		expect(deleteWorkspace).not.toHaveBeenCalled();

		await page.getByRole("button", { name: "Select workspace: Work" }).click();
		await page.getByRole("menuitem", { name: "Delete Work" }).click();
		await page.getByRole("button", { name: "Delete workspace" }).click();
		expect(deleteWorkspace).toHaveBeenCalledWith(work.id);
		await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
	});
});
