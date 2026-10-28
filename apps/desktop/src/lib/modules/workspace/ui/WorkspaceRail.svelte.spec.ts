import "../../../../routes/layout.css";
import { page } from "vitest/browser";
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
