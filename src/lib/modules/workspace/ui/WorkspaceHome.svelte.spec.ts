import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { createDesktopClient } from "$lib/shared/desktop/contract";
import { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";
import WorkspaceHome from "./WorkspaceHome.svelte";

const first = "550e8400-e29b-41d4-a716-446655440000";
const second = "550e8400-e29b-41d4-a716-446655440001";
async function session(mode: "saved" | "empty" | "error" = "saved") {
	const workspace = new ElectronWorkspaceSessionState(
		createDesktopClient(async (channel) => {
			if (channel === "tuxedo:read-saved-views") return { status: "applied", views: [] };
			if (channel !== "tuxedo:restore-session") throw Error(`Unexpected ${channel}`);
			if (mode === "error") throw Error("Catalogue is unreadable");
			return {
				scope: "9426bd98-a6dd-48eb-b1ab-037d82983ae1",
				revision: 1,
				session: {
					status: "empty",
					catalogue: {
						version: 1,
						active_workspace_id: null,
						workspaces:
							mode === "empty"
								? []
								: [
										{
											id: second,
											name: "Personal",
											color: "green",
											todo_path: "/tmp/personal.txt",
											created_at: "2026-10-16T00:00:00Z",
										},
										{
											id: first,
											name: "Work",
											color: "blue",
											todo_path: "/tmp/work.txt",
											created_at: "2026-10-15T00:00:00Z",
										},
									],
					},
					warning: "Last Todo file could not be opened",
				},
			};
		})
	);
	await workspace.initialize();
	return workspace;
}
const actions = () => ({
	openWorkspace: vi.fn(async () => ({ status: "applied" as const })),
	openCreationDialog: vi.fn(),
	retry: vi.fn(async () => {}),
	goHome: vi.fn(async () => {}),
});

test("Home lists saved Workspaces in creation order with color and supports selection/creation", async () => {
	const callbacks = actions();
	render(WorkspaceHome, { workspace: await session(), ...callbacks });
	const buttons = page.getByRole("list").getByRole("button");
	await expect.element(buttons.nth(0)).toHaveTextContent("blue Work");
	await expect.element(buttons.nth(1)).toHaveTextContent("green Personal");
	await expect
		.element(page.getByRole("status"))
		.toHaveTextContent("Last Todo file could not be opened");
	await buttons.nth(1).click();
	expect(callbacks.openWorkspace).toHaveBeenCalledWith(second);
	await page.getByRole("button", { name: "New Workspace" }).click();
	expect(callbacks.openCreationDialog).toHaveBeenCalledOnce();
});

test("Home startup warning offers Retry while keeping the picker available", async () => {
	const callbacks = actions();
	render(WorkspaceHome, { workspace: await session(), ...callbacks });
	await expect
		.element(page.getByRole("status"))
		.toHaveTextContent("Last Todo file could not be opened");
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	expect(callbacks.retry).toHaveBeenCalledOnce();
	await expect.element(page.getByRole("button", { name: "blue Work" })).toBeEnabled();
});

test("Home with no saved Workspaces still offers creation", async () => {
	render(WorkspaceHome, { workspace: await session("empty"), ...actions() });
	await expect.element(page.getByText("Create a Workspace to open a Todo file.")).toBeVisible();
	await expect.element(page.getByRole("button", { name: "New Workspace" })).toBeEnabled();
});

test("loading and unavailable destinations never expose a retained Workspace picker", async () => {
	render(WorkspaceHome, { workspace: await session(), ...actions(), loading: true });
	await expect.element(page.getByRole("status")).toHaveTextContent("Loading Workspaces…");
	await expect.element(page.getByRole("button", { name: "blue Work" })).not.toBeInTheDocument();
});

test("unavailable destinations expose working Retry and Home, not retained data", async () => {
	const callbacks = actions();
	render(WorkspaceHome, {
		workspace: await session(),
		...callbacks,
		unavailable: "Workspace was deleted",
	});
	await expect.element(page.getByRole("alert")).toHaveTextContent("Workspace was deleted");
	await expect.element(page.getByRole("list")).not.toBeInTheDocument();
	await page.getByRole("button", { name: "Retry" }).click();
	await page.getByRole("button", { name: "Home" }).click();
	expect(callbacks.retry).toHaveBeenCalledOnce();
	expect(callbacks.goHome).toHaveBeenCalledOnce();
});

test("catalogue errors preserve the error and offer Retry", async () => {
	const callbacks = actions();
	render(WorkspaceHome, { workspace: await session("error"), ...callbacks });
	await expect.element(page.getByRole("alert")).toHaveTextContent("Catalogue is unreadable");
	await page.getByRole("button", { name: "Retry" }).click();
	expect(callbacks.retry).toHaveBeenCalledOnce();
	await expect.element(page.getByRole("button", { name: "New Workspace" })).not.toBeInTheDocument();
});

test("pending operations disable picker and creation actions", async () => {
	render(WorkspaceHome, { workspace: await session(), ...actions(), disabled: true });
	await expect.element(page.getByRole("button", { name: "blue Work" })).toBeDisabled();
	await expect.element(page.getByRole("button", { name: "New Workspace" })).toBeDisabled();
});
