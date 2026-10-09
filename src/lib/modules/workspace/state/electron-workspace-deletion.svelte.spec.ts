import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ElectronDeletionHarness from "./ElectronDeletionHarness.svelte";
import type { ConfirmedSession, DesktopAPI } from "$lib/shared/desktop/contract";
const workspace = {
	id: "550e8400-e29b-41d4-a716-446655440000",
	name: "Work",
	color: "blue" as const,
	todo_path: "/tmp/work.todo",
	created_at: "2026-07-10T10:00:00Z",
};
const initial: ConfirmedSession = {
	scope: "9426bd98-a6dd-48eb-b1ab-037d82983ae1",
	revision: 5,
	session: {
		status: "ready",
		catalogue: { version: 1, active_workspace_id: workspace.id, workspaces: [workspace] },
		todo_file: { path: workspace.todo_path, items: [], skipped: [] },
	},
};
function adapter(deleteWorkspace: DesktopAPI["deleteWorkspace"]): DesktopAPI {
	return {
		setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
		deleteTodo: async () => ({ status: "rejected", message: "unused" }),
		readSession: async () => initial,
		restoreSession: async () => initial,
		createWorkspace: async () => ({ status: "rejected", message: "unused" }),
		selectTodoFile: async () => null,
		switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
		deleteWorkspace,
		createTodo: async () => ({ status: "rejected", message: "unused" }),
	};
}
async function confirm() {
	await page.getByRole("button", { name: /Select workspace: Work/ }).click();
	await page.getByRole("menuitem", { name: "Delete Work", exact: true }).click();
	await expect.element(page.getByRole("alertdialog")).toBeVisible();
	await page.getByRole("button", { name: "Delete workspace", exact: true }).click();
}
test("cancellation preserves the confirmed Workspace and confirmed deletion publishes Empty with pending controls", async () => {
	let finish!: (outcome: Awaited<ReturnType<DesktopAPI["deleteWorkspace"]>>) => void;
	let calls = 0;
	render(ElectronDeletionHarness, {
		desktop: adapter((input) => {
			expect(input.workspaceId).toBe(workspace.id);
			calls++;
			return new Promise((resolve) => {
				finish = resolve;
			});
		}),
	});
	await page.getByRole("button", { name: /Select workspace: Work/ }).click();
	await page.getByRole("menuitem", { name: "Delete Work", exact: true }).click();
	await page.getByRole("button", { name: "Cancel" }).click();
	expect(calls).toBe(0);
	await expect.element(page.getByLabelText("Workspace count")).toHaveTextContent("1");
	await confirm();
	await expect
		.element(page.getByLabelText("Pending operation"))
		.toHaveTextContent("delete_workspace");
	await expect.element(page.getByRole("button", { name: /Select workspace: Work/ })).toBeDisabled();
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("ready");
	finish({
		status: "applied",
		confirmed: {
			...initial,
			revision: 6,
			session: {
				status: "empty",
				catalogue: { version: 1, active_workspace_id: null, workspaces: [] },
				warning: null,
			},
		},
	});
	await expect.element(page.getByLabelText("Workspace count")).toHaveTextContent("0");
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("empty");
	await expect
		.element(page.getByRole("button", { name: /Select workspace: No workspace selected/ }))
		.toBeEnabled();
});
test.each(["rejected", "old", "wrong-scope"])(
	"deletion outcome %s preserves the current confirmed Workspace",
	async (kind) => {
		render(ElectronDeletionHarness, {
			desktop: adapter(async () =>
				kind === "rejected"
					? { status: "rejected", message: "Catalogue write failed" }
					: {
							status: "applied",
							confirmed: {
								...initial,
								scope:
									kind === "wrong-scope" ? "550e8400-e29b-41d4-a716-446655440099" : initial.scope,
								revision: kind === "old" ? 4 : 6,
								session: {
									status: "empty",
									catalogue: { version: 1, active_workspace_id: null, workspaces: [] },
									warning: null,
								},
							},
						}
			),
		});
		await confirm();
		await expect.element(page.getByLabelText("Pending operation")).toHaveTextContent("none");
		await expect
			.element(page.getByRole("button", { name: /Select workspace: Work/ }))
			.toBeEnabled();
		await expect.element(page.getByLabelText("Workspace count")).toHaveTextContent("1");
		await expect.element(page.getByLabelText("Session status")).toHaveTextContent("ready");
	}
);
