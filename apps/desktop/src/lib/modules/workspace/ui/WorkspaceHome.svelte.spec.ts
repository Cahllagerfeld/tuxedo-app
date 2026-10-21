import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import WorkspaceHome from "./WorkspaceHome.svelte";
import type { WorkspaceCatalogue } from "../domain/workspace";

const catalogue: WorkspaceCatalogue = {
	version: 1,
	active_workspace_id: "550e8400-e29b-41d4-a716-446655440002",
	workspaces: [2, 0, 1].map((index) => ({
		id: `550e8400-e29b-41d4-a716-44665544000${index}`,
		name: `Workspace ${index}`,
		color: "blue",
		todo_path: `/tmp/workspace-${index}.todo`,
		created_at: `2026-07-1${index}T10:00:00+00:00`,
	})),
};

test("Home puts the last-opened Workspace first and keeps the others in creation order", async () => {
	const props = {
		catalogue,
		disabled: false,
		deleteWorkspace: vi.fn(),
		openWorkspaceCreationDialog: vi.fn(),
	};
	const view = await render(WorkspaceHome, props);
	const links = page.getByRole("navigation", { name: "Saved workspaces" }).getByRole("link");
	await expect.element(links.nth(0)).toHaveAccessibleName("Workspace 2");
	await expect.element(links.nth(1)).toHaveAccessibleName("Workspace 0");
	await expect.element(links.nth(2)).toHaveAccessibleName("Workspace 1");

	await view.rerender({
		...props,
		catalogue: { ...catalogue, active_workspace_id: catalogue.workspaces[2].id },
	});
	await expect.element(links.nth(0)).toHaveAccessibleName("Workspace 1");
	await expect.element(links.nth(1)).toHaveAccessibleName("Workspace 0");
	await expect.element(links.nth(2)).toHaveAccessibleName("Workspace 2");

	await view.rerender({ ...props, catalogue: { ...catalogue, active_workspace_id: null } });
	await expect.element(links.nth(0)).toHaveAccessibleName("Workspace 0");
	await expect.element(links.nth(1)).toHaveAccessibleName("Workspace 1");
	await expect.element(links.nth(2)).toHaveAccessibleName("Workspace 2");
	expect(catalogue.workspaces.map(({ name }) => name)).toEqual([
		"Workspace 2",
		"Workspace 0",
		"Workspace 1",
	]);
});
