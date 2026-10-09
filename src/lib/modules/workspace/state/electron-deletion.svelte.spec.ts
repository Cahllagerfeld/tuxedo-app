import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ElectronTodoHarness from "./ElectronTodoHarness.svelte";
import type { ConfirmedSession, DesktopAPI } from "$lib/shared/desktop/contract";
const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const open = {
	line_number: 1,
	raw: "Delete +Work",
	description: "Delete",
	completed: false,
	priority: null,
	creation_date: null,
	completion_date: null,
	projects: ["Work"],
	contexts: [],
	metadata: {},
};
const completed = {
	...open,
	line_number: 2,
	raw: "x 2026-07-10 Finished +Home",
	description: "Finished",
	completed: true,
	completion_date: "2026-07-10",
	projects: ["Home"],
};
const initial: ConfirmedSession = {
	scope,
	revision: 5,
	session: {
		status: "ready",
		catalogue: {
			version: 1,
			active_workspace_id: workspaceId,
			workspaces: [
				{
					id: workspaceId,
					name: "Personal",
					color: "blue",
					todo_path: "/tmp/todo.txt",
					created_at: "2026-07-10T10:00:00Z",
				},
			],
		},
		todo_file: { path: "/tmp/todo.txt", items: [open, completed], skipped: [] },
	},
};
function desktop(deleteTodo: DesktopAPI["deleteTodo"]): DesktopAPI {
	return {
		readSession: async () => initial,
		restoreSession: async () => initial,
		selectTodoFile: async () => null,
		createWorkspace: async () => ({ status: "rejected", message: "unused" }),
		switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
		deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
		setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
		deleteTodo,
		createTodo: async () => ({ status: "rejected", message: "unused" }),
	};
}
test("row deletion is bound to the confirmed Workspace and keeps controls and summaries pending until confirmation", async () => {
	let finish!: (value: Awaited<ReturnType<DesktopAPI["deleteTodo"]>>) => void;
	let request: unknown;
	render(ElectronTodoHarness, {
		desktop: desktop((input) => {
			request = input;
			return new Promise((resolve) => {
				finish = resolve;
			});
		}),
	});
	await expect.element(page.getByLabelText("Total items")).toHaveTextContent("2");
	await page.getByRole("button", { name: "Delete Delete", exact: true }).click();
	expect(request).toMatchObject({
		scope,
		revision: 5,
		workspaceId,
		lineNumber: 1,
		expectedRaw: "Delete +Work",
	});
	await expect.element(page.getByRole("button", { name: "Switch", exact: true })).toBeDisabled();
	await expect
		.element(page.getByLabelText("Pending target"))
		.toHaveTextContent('{"workspaceId":"550e8400-e29b-41d4-a716-446655440000","lineNumber":1}');
	await expect
		.element(page.getByRole("checkbox", { name: "Mark Finished incomplete" }))
		.toBeDisabled();
	await expect.element(page.getByLabelText("Total items")).toHaveTextContent("2");
	finish({
		status: "applied",
		confirmed: {
			scope,
			revision: 6,
			workspaceId,
			todo_file: { path: "/tmp/todo.txt", items: [{ ...completed, line_number: 1 }], skipped: [] },
		},
	});
	await expect.element(page.getByLabelText("Total items")).toHaveTextContent("1");
	await expect.element(page.getByLabelText("Open items")).toHaveTextContent("0");
	await expect.element(page.getByLabelText("Completed items")).toHaveTextContent("1");
	await expect.element(page.getByLabelText("Projects")).toHaveTextContent("Home");
	await expect.element(page.getByLabelText("Pending target")).toHaveTextContent("none");
	await expect
		.element(page.getByRole("button", { name: "Delete Delete", exact: true }))
		.not.toBeInTheDocument();
});

test("a completed row deletion conflict replaces list and summary with current disk content", async () => {
	const changed = { ...open, raw: "Changed +Fresh", description: "Changed", projects: ["Fresh"] };
	render(ElectronTodoHarness, {
		desktop: desktop(async () => ({
			status: "conflict",
			message: "Changed on disk",
			confirmed: {
				scope,
				revision: 6,
				workspaceId,
				todo_file: { path: "/tmp/todo.txt", items: [changed], skipped: [] },
			},
		})),
	});
	await page.getByRole("button", { name: "Delete Finished", exact: true }).click();
	await expect.element(page.getByLabelText("Action result")).toHaveTextContent("Changed on disk");
	await expect.element(page.getByLabelText("Total items")).toHaveTextContent("1");
	await expect.element(page.getByLabelText("Projects")).toHaveTextContent("Fresh");
	await expect
		.element(page.getByRole("button", { name: "Delete Changed", exact: true }))
		.toBeInTheDocument();
});
test.each(["rejected", "transport"])(
	"deletion failure (%s) preserves the confirmed list and releases pending controls without retrying",
	async (failure) => {
		let attempts = 0;
		render(ElectronTodoHarness, {
			desktop: desktop(async () => {
				attempts++;
				if (failure === "transport") throw Error("Cannot write file");
				return { status: "rejected", message: "Cannot write file" };
			}),
		});
		await page.getByRole("button", { name: "Delete Delete", exact: true }).click();
		await expect
			.element(page.getByLabelText("Action result"))
			.toHaveTextContent("Cannot write file");
		await expect.element(page.getByLabelText("Total items")).toHaveTextContent("2");
		await expect
			.element(page.getByRole("button", { name: "Delete Delete", exact: true }))
			.toBeEnabled();
		expect(attempts).toBe(1);
	}
);
test.each(["older", "scope", "workspace", "path"])(
	"late or wrong-scope deletion result (%s) cannot overwrite the confirmed Todo file",
	async (kind) => {
		render(ElectronTodoHarness, {
			desktop: desktop(async () => ({
				status: "applied",
				confirmed: {
					scope: kind === "scope" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : scope,
					revision: kind === "older" ? 4 : 6,
					workspaceId: kind === "workspace" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : workspaceId,
					todo_file: {
						path: kind === "path" ? "/tmp/other.todo" : "/tmp/todo.txt",
						items: [],
						skipped: [],
					},
				},
			})),
		});
		await page.getByRole("button", { name: "Delete Delete", exact: true }).click();
		await expect.element(page.getByLabelText("Action result")).toHaveTextContent("Applied");
		await expect.element(page.getByLabelText("Total items")).toHaveTextContent("2");
		await expect
			.element(page.getByRole("button", { name: "Delete Delete", exact: true }))
			.toBeEnabled();
	}
);
