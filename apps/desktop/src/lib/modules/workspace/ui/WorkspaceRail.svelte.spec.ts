import "../../../../routes/layout.css";
import { page, userEvent } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import WorkspaceRail from "./WorkspaceRail.svelte";

it("offers Workspace view links and marks the current view", async () => {
	const props = {
		workspaces: [],
		activeWorkspaceId: null,
		viewMode: "list" as const,
		listHref: "/workspaces/example",
		kanbanHref: "/workspaces/example/kanban",
		selectWorkspace: vi.fn(),
		deleteWorkspace: vi.fn(),
		openCreationDialog: vi.fn(),
	};
	const view = await render(WorkspaceRail, props);
	await expect
		.element(page.getByRole("link", { name: "List" }))
		.toHaveAttribute("href", props.listHref);
	await expect
		.element(page.getByRole("link", { name: "List" }))
		.toHaveAttribute("aria-current", "page");
	await expect
		.element(page.getByRole("link", { name: "Kanban" }))
		.toHaveAttribute("href", props.kanbanHref);

	await view.rerender({ ...props, viewMode: "kanban" });
	await expect
		.element(page.getByRole("link", { name: "Kanban" }))
		.toHaveAttribute("aria-current", "page");
	await expect
		.element(page.getByRole("link", { name: "List" }))
		.not.toHaveAttribute("aria-current");

	await view.rerender({ ...props, disabled: true });
	await expect
		.element(page.getByRole("link", { name: "Kanban" }))
		.toHaveAttribute("aria-disabled", "true");
	await expect.element(page.getByRole("link", { name: "Kanban" })).not.toHaveAttribute("href");
});

it("describes rail controls on hover and keyboard focus", async () => {
	render(WorkspaceRail, {
		workspaces: [],
		activeWorkspaceId: null,
		viewMode: "list",
		listHref: "/workspaces/example",
		kanbanHref: "/workspaces/example/kanban",
		selectWorkspace: vi.fn(),
		deleteWorkspace: vi.fn(),
		openCreationDialog: vi.fn(),
	});

	const switcher = page.getByRole("button", { name: "Select workspace: No workspace selected" });
	const list = page.getByRole("link", { name: "List" });
	const kanban = page.getByRole("link", { name: "Kanban" });
	await switcher.hover();
	await expect
		.element(page.getByRole("tooltip"))
		.toHaveTextContent("Switch workspace: No workspace selected");
	await userEvent.keyboard("{Escape}");
	await list.hover();
	await expect.element(page.getByRole("tooltip")).toHaveTextContent("List view");
	await userEvent.keyboard("{Escape}");
	await kanban.hover();
	await expect.element(page.getByRole("tooltip")).toHaveTextContent("Kanban view");
	await userEvent.keyboard("{Escape}");
	await userEvent.keyboard("{Tab}");
	await expect.element(switcher).toHaveFocus();
	await expect
		.element(page.getByRole("tooltip"))
		.toHaveTextContent("Switch workspace: No workspace selected");
	await userEvent.keyboard("{Tab}");
	await expect.element(list).toHaveFocus();
	await expect.element(page.getByRole("tooltip")).toHaveTextContent("List view");
	await userEvent.keyboard("{Tab}");
	await expect.element(kanban).toHaveFocus();
	await expect.element(page.getByRole("tooltip")).toHaveTextContent("Kanban view");
});

it.each([
	{
		role: "button",
		name: "Select workspace: No workspace selected",
		tooltip: "Switch workspace: No workspace selected",
	},
	{ role: "link", name: "List", tooltip: "List view" },
	{ role: "link", name: "Kanban", tooltip: "Kanban view" },
] as const)(
	"delays the $name tooltip and cancels brief hovers",
	async ({ role, name, tooltip }) => {
		await render(WorkspaceRail, {
			workspaces: [],
			activeWorkspaceId: null,
			viewMode: "list",
			listHref: "/workspaces/example",
			kanbanHref: "/workspaces/example/kanban",
			selectWorkspace: vi.fn(),
			deleteWorkspace: vi.fn(),
			openCreationDialog: vi.fn(),
		});
		const control = page.getByRole(role, { name }).element();
		await page.getByRole("navigation", { name: "Workspace navigation" }).unhover();
		await expect.element(page.getByRole("tooltip")).not.toBeInTheDocument();
		vi.useFakeTimers();
		try {
			control.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
			await vi.advanceTimersByTimeAsync(399);
			expect(document.querySelector('[role="tooltip"]')).toBeNull();
			control.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
			await vi.advanceTimersByTimeAsync(1);
			expect(document.querySelector('[role="tooltip"]')).toBeNull();
			control.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
			await vi.advanceTimersByTimeAsync(400);
			expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(tooltip);
		} finally {
			vi.useRealTimers();
		}
	}
);

it.each(["light", "dark"])("highlights rail items on hover in %s mode", async (theme) => {
	document.documentElement.classList.toggle("dark", theme === "dark");
	try {
		render(WorkspaceRail, {
			workspaces: [],
			activeWorkspaceId: null,
			viewMode: "kanban",
			listHref: "/workspaces/example",
			kanbanHref: "/workspaces/example/kanban",
			selectWorkspace: vi.fn(),
			deleteWorkspace: vi.fn(),
			openCreationDialog: vi.fn(),
		});
		for (const item of [
			page.getByRole("button", { name: "Select workspace: No workspace selected" }),
			page.getByRole("link", { name: "List" }),
			page.getByRole("link", { name: "Kanban" }),
		]) {
			const element = item.element();
			const restingColor = getComputedStyle(element).backgroundColor;
			await item.hover();
			void getComputedStyle(element).backgroundColor;
			await Promise.all(element.getAnimations().map((animation) => animation.finished));
			const hoverColor = getComputedStyle(element).backgroundColor;
			expect(hoverColor).not.toBe(restingColor);
			expect(hoverColor).not.toBe("rgba(0, 0, 0, 0)");
		}
	} finally {
		document.documentElement.classList.remove("dark");
	}
});
