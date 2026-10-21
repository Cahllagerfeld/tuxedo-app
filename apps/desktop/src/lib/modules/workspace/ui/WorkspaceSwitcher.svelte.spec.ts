import "../../../../routes/layout.css";
import { page, userEvent } from "vitest/browser";
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
		const selectWorkspace = vi.fn(async () => ({ status: "applied" as const }));
		render(WorkspaceSwitcher, {
			workspaces: [personal, work],
			activeWorkspaceId: personal.id,
			selectWorkspace,
			deleteWorkspace: vi.fn(),
			openCreationDialog: vi.fn(),
		});

		await page.getByRole("button", { name: /Select workspace: Personal/ }).click();
		const entries = page.getByRole("menuitem");
		await expect.element(entries.nth(0)).toMatchTextContent("Work");
		await expect.element(entries.nth(2)).toMatchTextContent("Personal");
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

		await page.getByRole("button", { name: /Select workspace: No workspace selected/ }).click();
		await expect.element(page.getByText("No saved workspaces yet.")).toBeVisible();
		await page.getByRole("menuitem", { name: "New workspace" }).click();
		expect(openCreationDialog).toHaveBeenCalledOnce();
	});

	it("disables its controls while a lifecycle operation is running", async () => {
		render(WorkspaceSwitcher, {
			workspaces: [work],
			activeWorkspaceId: work.id,
			selectWorkspace: vi.fn(),
			deleteWorkspace: vi.fn(),
			openCreationDialog: vi.fn(),
			disabled: true,
		});

		await expect
			.element(page.getByRole("button", { name: /Select workspace: Work/ }))
			.toBeDisabled();
	});

	it("disables an already-open deletion confirmation when another operation starts", async () => {
		const props = {
			workspaces: [work],
			activeWorkspaceId: work.id,
			selectWorkspace: vi.fn(),
			deleteWorkspace: vi.fn(),
			openCreationDialog: vi.fn(),
			disabled: false,
		};
		const view = await render(WorkspaceSwitcher, props);
		await page.getByRole("button", { name: /Select workspace: Work/ }).click();
		await page.getByRole("menuitem", { name: "Options for Work" }).click();
		await page.getByRole("menuitem", { name: "Remove workspace" }).click();

		await view.rerender({ ...props, disabled: true });

		await expect.element(page.getByRole("button", { name: "Remove workspace" })).toBeDisabled();
	});

	it("requires confirmation before deleting the active workspace", async () => {
		const deleteWorkspace = vi.fn(async () => ({ status: "applied" as const }));
		render(WorkspaceSwitcher, {
			workspaces: [work],
			activeWorkspaceId: work.id,
			selectWorkspace: vi.fn(),
			deleteWorkspace,
			openCreationDialog: vi.fn(),
		});

		await page.getByRole("button", { name: /Select workspace: Work/ }).click();
		await page.getByRole("menuitem", { name: "Options for Work" }).click();
		await page.getByRole("menuitem", { name: "Remove workspace" }).click();
		await expect.element(page.getByRole("alertdialog")).toBeVisible();
		await expect.element(page.getByText("Remove workspace?", { exact: true })).toBeVisible();
		expect(deleteWorkspace).not.toHaveBeenCalled();

		await page.getByRole("button", { name: "Cancel" }).click();
		expect(deleteWorkspace).not.toHaveBeenCalled();

		await page.getByRole("button", { name: /Select workspace: Work/ }).click();
		await page.getByRole("menuitem", { name: "Options for Work" }).click();
		await page.getByRole("menuitem", { name: "Remove workspace" }).click();
		await page.getByRole("button", { name: "Remove workspace" }).click();
		expect(deleteWorkspace).toHaveBeenCalledWith(work.id);
		await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
	});

	it("closes its delete confirmation before the deletion lifecycle operation runs", async () => {
		let releaseDeletion!: () => void;
		const pendingDeletion = new Promise<{ status: "applied" }>(
			(resolve) => (releaseDeletion = () => resolve({ status: "applied" }))
		);
		const deleteWorkspace = vi.fn(() => pendingDeletion);
		render(WorkspaceSwitcher, {
			workspaces: [work],
			activeWorkspaceId: work.id,
			selectWorkspace: vi.fn(),
			deleteWorkspace,
			openCreationDialog: vi.fn(),
		});

		await page.getByRole("button", { name: /Select workspace: Work/ }).click();
		await page.getByRole("menuitem", { name: "Options for Work" }).click();
		await page.getByRole("menuitem", { name: "Remove workspace" }).click();
		await page.getByRole("button", { name: "Remove workspace" }).click();

		expect(deleteWorkspace).toHaveBeenCalledWith(work.id);
		await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
		releaseDeletion();
	});
});

it("opens inactive Workspace options without selecting and confirms the named target", async () => {
	const selectWorkspace = vi.fn();
	const deleteWorkspace = vi.fn(async () => ({ status: "applied" as const }));
	render(WorkspaceSwitcher, {
		workspaces: [work, personal],
		activeWorkspaceId: work.id,
		selectWorkspace,
		deleteWorkspace,
		openCreationDialog: vi.fn(),
	});
	await page.getByRole("button", { name: /Select workspace: Work/ }).click();
	await page.getByRole("menuitem", { name: "Options for Personal" }).click();
	await page.getByRole("menuitem", { name: "Remove workspace" }).click();
	await expect
		.element(page.getByRole("alertdialog"))
		.toMatchTextContent(
			"Remove Personal from saved Workspaces? Its Todo file will not be deleted."
		);
	expect(selectWorkspace).not.toHaveBeenCalled();
	await page.getByRole("button", { name: "Remove workspace", exact: true }).click();
	expect(deleteWorkspace).toHaveBeenCalledWith(personal.id);
});

it("reaches each Workspace's options and cancels or confirms using the keyboard", async () => {
	const selectWorkspace = vi.fn();
	const deleteWorkspace = vi.fn(async () => ({ status: "applied" as const }));
	render(WorkspaceSwitcher, {
		workspaces: [work, personal],
		activeWorkspaceId: work.id,
		selectWorkspace,
		deleteWorkspace,
		openCreationDialog: vi.fn(),
	});
	async function openWithKeyboard() {
		await page.getByRole("button", { name: /Select workspace: Work/ }).click();
		await userEvent.keyboard("{Home}{ArrowDown}");
		await expect.element(page.getByRole("menuitem", { name: "Options for Work" })).toHaveFocus();
		await userEvent.keyboard("{End}{ArrowUp}");
		await expect
			.element(page.getByRole("menuitem", { name: "Options for Personal" }))
			.toHaveFocus();
		await userEvent.keyboard("{Enter}");
		await expect
			.element(page.getByRole("menuitem", { name: "Remove workspace", exact: true }))
			.toHaveFocus();
		await userEvent.keyboard("{Enter}");
		await expect.element(page.getByRole("alertdialog")).toBeVisible();
		await userEvent.keyboard("{Tab}");
		await expect.element(page.getByRole("button", { name: "Cancel" })).toHaveFocus();
	}
	await openWithKeyboard();
	await userEvent.keyboard("{Enter}");
	await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
	expect(deleteWorkspace).not.toHaveBeenCalled();
	await openWithKeyboard();
	await userEvent.keyboard("{Tab}{Enter}");
	expect(deleteWorkspace).toHaveBeenCalledWith(personal.id);
	expect(selectWorkspace).not.toHaveBeenCalled();
});

it("opens Workspace options on activation, never on hover", async () => {
	const selectWorkspace = vi.fn();
	render(WorkspaceSwitcher, {
		workspaces: [work, personal],
		activeWorkspaceId: work.id,
		selectWorkspace,
		deleteWorkspace: vi.fn(),
		openCreationDialog: vi.fn(),
	});
	await page.getByRole("button", { name: /Select workspace: Work/ }).click();
	const options = page.getByRole("menuitem", { name: "Options for Personal" });
	await options.hover();
	await expect.element(options).toHaveAttribute("aria-expanded", "false");
	await options.click();
	await expect
		.element(page.getByRole("menuitem", { name: "Remove workspace", exact: true }))
		.toBeVisible();
	await options.click();
	await expect.element(options).toHaveAttribute("aria-expanded", "false");
	expect(selectWorkspace).not.toHaveBeenCalled();
});

it("highlights the entire switcher row and keeps options separately focusable", async () => {
	const selectWorkspace = vi.fn();
	render(WorkspaceSwitcher, {
		workspaces: [work, personal],
		activeWorkspaceId: work.id,
		selectWorkspace,
		deleteWorkspace: vi.fn(),
		openCreationDialog: vi.fn(),
	});
	await page.getByRole("button", { name: /Select workspace: Work/ }).click();
	const item = page.getByRole("menuitem", { name: "Personal", exact: true });
	const options = page.getByRole("menuitem", { name: "Options for Personal", exact: true });
	const row = item.element().parentElement!;
	const background = (element: Element) => getComputedStyle(element).backgroundColor;
	const initial = background(row);
	await item.hover();
	await expect.poll(() => background(row)).not.toBe(initial);
	expect(background(item.element())).toBe("rgba(0, 0, 0, 0)");
	await options.hover();
	await expect.poll(() => background(options.element())).not.toBe("rgba(0, 0, 0, 0)");
	expect(background(row)).not.toBe(initial);
	await expect.element(options).toHaveAttribute("aria-expanded", "false");
	expect(selectWorkspace).not.toHaveBeenCalled();
});

it("clicking the switcher row gap selects the Workspace while clicking options only opens its menu", async () => {
	const selectWorkspace = vi.fn();
	await render(WorkspaceSwitcher, {
		workspaces: [work, personal],
		activeWorkspaceId: work.id,
		selectWorkspace,
		deleteWorkspace: vi.fn(),
		openCreationDialog: vi.fn(),
	});
	const switcher = page.getByRole("button", { name: /Select workspace: Work/ });
	await switcher.click();
	const item = page.getByRole("menuitem", { name: "Personal", exact: true });
	const options = page.getByRole("menuitem", { name: "Options for Personal", exact: true });
	const row = item.element().parentElement!;
	const gapX =
		options.element().getBoundingClientRect().left - row.getBoundingClientRect().left - 2;
	await userEvent.click(row, { position: { x: gapX, y: row.clientHeight / 2 } });
	expect(selectWorkspace).toHaveBeenCalledExactlyOnceWith(personal.id);
	await switcher.click();
	await options.click();
	await expect
		.element(page.getByRole("menuitem", { name: "Remove workspace", exact: true }))
		.toBeVisible();
	expect(selectWorkspace).toHaveBeenCalledOnce();
});
