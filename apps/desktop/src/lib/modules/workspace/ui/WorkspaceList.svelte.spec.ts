import "../../../../routes/layout.css";
import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import WorkspaceList from "./WorkspaceList.svelte";
import type { Workspace } from "../domain/workspace";

const work: Workspace = {
	id: "550e8400-e29b-41d4-a716-446655440000",
	name: "Work",
	color: "blue",
	todo_path: "/tmp/work.todo",
	created_at: "2026-07-10T10:00:00+00:00",
};
const personal: Workspace = {
	...work,
	id: "550e8400-e29b-41d4-a716-446655440001",
	name: "Personal",
};

test("Home options confirm the selected Workspace and allow cancelling and retrying", async () => {
	const deleteWorkspace = vi.fn(async () => ({
		status: "rejected" as const,
		message: "Try again",
	}));
	render(WorkspaceList, {
		workspaces: [work, personal],
		activeWorkspaceId: work.id,
		disabled: false,
		deleteWorkspace,
	});
	async function openRemoval() {
		await page.getByRole("button", { name: "Options for Personal", exact: true }).click();
		await page.getByRole("menuitem", { name: "Remove workspace", exact: true }).click();
		await expect
			.element(page.getByRole("alertdialog"))
			.toMatchTextContent(
				"Remove Personal from saved Workspaces? Its Todo file will not be deleted."
			);
	}
	await openRemoval();
	expect(deleteWorkspace).not.toHaveBeenCalled();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	expect(deleteWorkspace).not.toHaveBeenCalled();
	await openRemoval();
	await page.getByRole("button", { name: "Remove workspace", exact: true }).click();
	await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
	expect(deleteWorkspace).toHaveBeenCalledWith(personal.id);
	await openRemoval();
	await page.getByRole("button", { name: "Remove workspace", exact: true }).click();
	expect(deleteWorkspace).toHaveBeenCalledTimes(2);
});

test("Home disables options and an open confirmation while another operation runs", async () => {
	const deleteWorkspace = vi.fn();
	const props = {
		workspaces: [work],
		activeWorkspaceId: work.id,
		disabled: false,
		deleteWorkspace,
	};
	const view = await render(WorkspaceList, props);
	await page.getByRole("button", { name: "Options for Work", exact: true }).click();
	await page.getByRole("menuitem", { name: "Remove workspace", exact: true }).click();
	await view.rerender({ ...props, disabled: true });
	await expect
		.element(page.getByRole("button", { name: "Remove workspace", exact: true }))
		.toBeDisabled();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect
		.element(page.getByRole("button", { name: "Options for Work", exact: true }))
		.toBeDisabled();
	expect(deleteWorkspace).not.toHaveBeenCalled();
});

test("Home row padding follows the native link while the options button remains independent", async () => {
	await render(WorkspaceList, {
		workspaces: [work],
		activeWorkspaceId: work.id,
		disabled: false,
		deleteWorkspace: vi.fn(),
	});
	const link = page.getByRole("link", { name: "Work", exact: true });
	const options = page.getByRole("button", { name: "Options for Work", exact: true });
	const row = link.element().parentElement!;
	const navigate = vi.fn((event: Event) => event.preventDefault());
	link.element().addEventListener("click", navigate);
	await userEvent.click(row, { position: { x: row.clientWidth - 3, y: row.clientHeight / 2 } });
	expect(navigate).toHaveBeenCalledOnce();
	await options.click();
	await expect
		.element(page.getByRole("menuitem", { name: "Remove workspace", exact: true }))
		.toBeVisible();
	expect(navigate).toHaveBeenCalledOnce();
	await userEvent.keyboard("{Escape}");
	link.element().focus();
	await userEvent.keyboard("{Tab}");
	await expect.element(options).toHaveFocus();
});
