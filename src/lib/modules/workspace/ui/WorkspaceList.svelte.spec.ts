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

test.each(["light", "dark"])(
	"Home row hover spans the options area with an independent trigger in %s mode",
	async (mode) => {
		const wasDark = document.documentElement.classList.contains("dark");
		document.documentElement.classList.toggle("dark", mode === "dark");
		try {
			render(WorkspaceList, {
				workspaces: [work],
				activeWorkspaceId: work.id,
				disabled: false,
				deleteWorkspace: vi.fn(),
			});
			const link = page.getByRole("link", { name: "Work", exact: true });
			const options = page.getByRole("button", { name: "Options for Work", exact: true });
			const row = link.element().parentElement!;
			const background = (element: Element) => getComputedStyle(element).backgroundColor;
			const initial = background(row);
			await expect.element(options).toBeVisible();
			expect(link.element().contains(options.element())).toBe(false);
			await link.hover();
			await expect.poll(() => background(row)).not.toBe(initial);
			expect(background(link.element())).toBe("rgba(0, 0, 0, 0)");
			await options.hover();
			await expect.poll(() => background(row)).not.toBe(initial);
			await expect.poll(() => background(options.element())).not.toBe("rgba(0, 0, 0, 0)");
			await expect.element(options).toHaveAttribute("aria-expanded", "false");
			options.element().focus();
			await userEvent.keyboard("{Enter}");
			await expect
				.element(page.getByRole("menuitem", { name: "Remove workspace", exact: true }))
				.toBeVisible();
		} finally {
			document.documentElement.classList.toggle("dark", wasDark);
		}
	}
);
