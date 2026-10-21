import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import WorkspaceCreationDialog from "./WorkspaceCreationDialog.svelte";
import "../../../../routes/layout.css";

describe("WorkspaceCreationDialog", () => {
	it("keeps pending creation visible through Escape and outside clicks", async () => {
		let finish!: (outcome: { status: "rejected"; message: string }) => void;
		render(WorkspaceCreationDialog, {
			open: true,
			selectFile: async () => "/tmp/work.todo",
			createWorkspace: () => new Promise((resolve) => (finish = resolve)),
		});
		await page.getByLabelText("Workspace name").fill("Work");
		await page.getByText("Choose Todo file", { exact: true }).click();
		await page.getByRole("button", { name: "Create workspace" }).click();
		await expect.element(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByRole("dialog")).toBeVisible();
		await userEvent.click(document.querySelector('[data-slot="dialog-overlay"]')!, {
			position: { x: 5, y: 5 },
		});
		await expect.element(page.getByRole("dialog")).toBeVisible();
		finish({ status: "rejected", message: "Could not read Todo file." });
		await expect.element(page.getByRole("alert")).toHaveTextContent("Could not read Todo file.");
		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	});
	it("requires a name and selected Todo file before creation", async () => {
		const selectFile = vi.fn(async () => "/tmp/work.todo");
		const createWorkspace = vi.fn(async () => ({ status: "applied" as const }));
		render(WorkspaceCreationDialog, { open: true, selectFile, createWorkspace });

		const createButton = page.getByRole("button", { name: "Create workspace" });
		await expect.element(createButton).toBeDisabled();

		await page.getByLabelText("Workspace name").fill(" Work ");
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
			createWorkspace: async () => ({
				status: "rejected" as const,
				message: "duplicate workspace name: Work",
			}),
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
it("cancelling native file selection keeps the previously selected file and form", async () => {
	let selection: string | null = "/tmp/work.todo";
	render(WorkspaceCreationDialog, {
		open: true,
		selectFile: async () => selection,
		createWorkspace: async () => ({ status: "applied" }),
	});
	await page.getByLabelText("Workspace name").fill("Work");
	await page.getByText("Choose Todo file", { exact: true }).click();
	await expect.element(page.getByText("/tmp/work.todo", { exact: true })).toBeVisible();
	selection = null;
	await page.getByText("Choose Todo file", { exact: true }).click();
	await expect.element(page.getByText("/tmp/work.todo", { exact: true })).toBeVisible();
	await expect.element(page.getByLabelText("Workspace name")).toHaveValue("Work");
	await expect.element(page.getByRole("button", { name: "Create workspace" })).toBeEnabled();
});

it("reports a blank Todo-file reference at its form field without submitting", async () => {
	const createWorkspace = vi.fn(async () => ({ status: "applied" as const }));
	render(WorkspaceCreationDialog, { open: true, selectFile: async () => "   ", createWorkspace });
	await page.getByLabelText("Workspace name").fill("Work");
	await page.getByText("Choose Todo file", { exact: true }).click();
	await page.getByRole("button", { name: "Create workspace" }).click();
	await expect
		.element(page.getByText("Choose the exact Todo file for this workspace.", { exact: true }))
		.toBeVisible();
	expect(createWorkspace).not.toHaveBeenCalled();
});
