import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import WorkspaceCreationDialog from "./WorkspaceCreationDialog.svelte";

describe("WorkspaceCreationDialog", () => {
	it("requires a name and selected Todo file before creation", async () => {
		const selectFile = vi.fn(async () => "/tmp/work.todo");
		const createWorkspace = vi.fn(async () => {});
		render(WorkspaceCreationDialog, { open: true, selectFile, createWorkspace });

		const createButton = page.getByRole("button", { name: "Create workspace" });
		await expect.element(createButton).toBeDisabled();

		await page.getByLabelText("Workspace name").fill("Work");
		await page.getByText("Choose Todo file", { exact: true }).click();
		await expect.element(createButton).toBeEnabled();

		await createButton.click();
		expect(createWorkspace).toHaveBeenCalledWith({
			name: "Work",
			color: "blue",
			todoPath: "/tmp/work.todo",
		});
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	});

	it("shows a creation failure inline and lets the user cancel", async () => {
		render(WorkspaceCreationDialog, {
			open: true,
			selectFile: async () => "/tmp/work.todo",
			createWorkspace: async () => {
				throw new Error("duplicate workspace name: Work");
			},
		});

		await page.getByLabelText("Workspace name").fill("Work");
		await page.getByText("Choose Todo file", { exact: true }).click();
		await page.getByRole("button", { name: "Create workspace" }).click();

		await expect
			.element(page.getByRole("alert"))
			.toHaveTextContent("duplicate workspace name: Work");
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	});

	it("disables creation while a lifecycle operation is running", async () => {
		render(WorkspaceCreationDialog, { open: true, createWorkspace: vi.fn(), disabled: true });

		await expect.element(page.getByRole("button", { name: "Create workspace" })).toBeDisabled();
	});
});
