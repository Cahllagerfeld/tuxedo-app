import { loaderDesktop } from "#lib/modules/workspace/state/testing/loader-desktop.js";
import { page, userEvent } from "vitest/browser";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { toast } from "svelte-sonner";
import type { ConfirmedSession, DesktopAPI, TodoFile, TodoFileChange } from "@tuxedo/contracts";
import Harness from "./WorkspaceContentHarness.svelte";
import "#lib/../routes/layout.css";
afterEach(async () => {
	vi.useRealTimers();
	// Sonner's shared state survives component cleanup between tests.
	toast.dismiss();
	await expect.poll(() => document.querySelectorAll("[data-sonner-toast]").length).toBe(0);
});

const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const todo: TodoFile["items"][number] = {
	line_number: 1,
	raw: "Plan release +Work",
	completed: false,
	priority: null,
	creation_date: null,
	completion_date: null,
	description: "Plan release",
	projects: ["Work"],
	contexts: [],
	metadata: {},

	edit: { description: "Plan release", metadata: [] },
};
const initial: ConfirmedSession = {
	scope,
	revision: 1,
	session: {
		status: "ready",
		catalogue: {
			version: 1,
			active_workspace_id: workspaceId,
			workspaces: [
				{
					id: workspaceId,
					name: "Work",
					color: "blue",
					todo_path: "/tmp/work.todo",
					created_at: "2026-07-10T10:00:00Z",
				},
			],
		},
		todo_file: { path: "/tmp/work.todo", items: [todo], skipped: [] },
	},
};
function adapter(overrides: Partial<DesktopAPI> = {}): DesktopAPI {
	return loaderDesktop({
		readSavedViews: async () => ({ status: "applied", workspaceId, views: [] }),
		saveView: async () => ({ status: "rejected", message: "unused" }),
		deleteView: async () => ({ status: "rejected", message: "unused" }),
		readSession: async () => initial,
		refreshSession: overrides.readSession ?? (async () => initial),
		writeClipboardText: async () => null,
		selectTodoFile: async () => null,
		selectNewTodoFile: async () => null,
		createWorkspace: async () => ({ status: "rejected", message: "unused" }),
		switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
		deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
		setWorkspaceSortOrder: async () => ({ status: "rejected", message: "unused" }),
		setWorkspaceShowDeferred: async () => ({ status: "rejected", message: "unused" }),
		undoTodo: async () => ({ status: "rejected", message: "unused" }),
		setTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
		bulkSetTodoCompletion: async () => ({ status: "rejected", message: "unused" }),
		bulkDeleteTodos: async () => ({ status: "rejected", message: "unused" }),
		editTodo: async () => ({ status: "rejected", message: "unused" }),
		deleteTodo: async () => ({ status: "rejected", message: "unused" }),
		reorderTodo: async () => ({ status: "rejected", message: "unused" }),
		moveTodoOnBoard: async () => ({ status: "rejected", message: "unused" }),
		reorderTodosOnBoard: async () => ({ status: "rejected", message: "unused" }),
		createTodo: async () => ({ status: "rejected", message: "unused" }),
		...overrides,
	});
}
function confirmedTodo(items: TodoFile["items"]) {
	return {
		scope,
		revision: 2,
		workspaceId,
		todo_file: { path: "/tmp/work.todo", items, skipped: [] },
	};
}

async function keyboardBoardMove(destination: "to-do" | "in-progress") {
	const card = page.getByRole("listitem", { name: "Plan release" });
	await expect.element(card).toBeVisible();
	(card.element() as HTMLElement).focus();
	await userEvent.keyboard(
		destination === "to-do" ? "{Space}{Tab}{Space}" : "{Space}{Tab}{Tab}{Space}"
	);
}

test("a keyboard board move keeps confirmed contents while saving, then updates selection and Undo", async () => {
	await page.viewport(1400, 900);
	const response = Promise.withResolvers<Awaited<ReturnType<DesktopAPI["moveTodoOnBoard"]>>>();
	const moveTodoOnBoard = vi.fn<DesktopAPI["moveTodoOnBoard"]>(() => response.promise);
	render(Harness, { viewMode: "kanban", shell: true, desktop: adapter({ moveTodoOnBoard }) });
	const unassigned = page.getByRole("region", { name: "Unassigned", exact: true });
	const todoColumn = page.getByRole("region", { name: "To do", exact: true });
	await unassigned.getByRole("button", { name: "Open Plan release" }).click();
	await keyboardBoardMove("to-do");
	await expect.element(unassigned.getByRole("button", { name: "Open Plan release" })).toBeVisible();
	const moved = {
		...todo,
		raw: `${todo.raw} board:to-do`,
		metadata: { board: "to-do" },
		edit: { ...todo.edit, metadata: ["board:to-do"] },
	};
	response.resolve({
		status: "applied",
		confirmed: { ...confirmedTodo([moved]), undoLabel: "Undo move" },
	});
	await expect.element(todoColumn.getByRole("button", { name: "Open Plan release" })).toBeVisible();
	await expect.element(todoColumn.getByRole("button", { name: "Open Plan release" })).toHaveFocus();
	await expect
		.element(
			page
				.getByRole("complementary", { name: "Todo item details" })
				.getByRole("heading", { name: "Plan release" })
		)
		.toBeVisible();
	await expect.element(page.getByRole("button", { name: "Undo move" })).toBeEnabled();
	expect(moveTodoOnBoard).toHaveBeenCalledExactlyOnceWith({
		scope,
		revision: 1,
		workspaceId,
		lineNumber: 1,
		expectedRaw: todo.raw,
		column: "to-do",
	});
});

test("a move to Done hidden by the Open filter confirms it and Undo restores the card", async () => {
	await page.viewport(1400, 900);
	const completed = {
		...todo,
		raw: `x 2026-10-29 ${todo.raw}`,
		completed: true,
		completion_date: "2026-10-29",
	};
	const moveTodoOnBoard = vi.fn<DesktopAPI["moveTodoOnBoard"]>(async () => ({
		status: "applied",
		confirmed: { ...confirmedTodo([completed]), undoLabel: "Undo completion" },
	}));
	const undoTodo = vi.fn<DesktopAPI["undoTodo"]>(async () => ({
		status: "applied",
		confirmed: { ...confirmedTodo([todo]), revision: 3 },
	}));
	render(Harness, {
		viewMode: "kanban",
		shell: true,
		desktop: adapter({ moveTodoOnBoard, undoTodo }),
	});
	await page.getByRole("button", { name: /^Open \d+$/ }).click();
	const card = page.getByRole("listitem", { name: "Plan release" });
	await expect.element(card).toBeVisible();
	(card.element() as HTMLElement).focus();
	await userEvent.keyboard("{Space}{Tab}{Tab}{Tab}{Space}");
	await expect.element(page.getByText("Todo item completed")).toBeVisible();
	expect(moveTodoOnBoard.mock.calls[0][0]).toMatchObject({ column: "done" });
	expect(page.getByRole("button", { name: "Open Plan release" }).elements()).toHaveLength(0);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect
		.element(
			page
				.getByRole("region", { name: "Unassigned", exact: true })
				.getByRole("button", { name: "Open Plan release" })
		)
		.toBeVisible();
	expect(undoTodo).toHaveBeenCalledExactlyOnceWith({ scope, revision: 2, workspaceId });
});

test("a failed board move retains confirmed state and reports the error", async () => {
	await page.viewport(1400, 900);
	const moveTodoOnBoard = vi.fn<DesktopAPI["moveTodoOnBoard"]>(async () => ({
		status: "rejected",
		message: "Write failed",
	}));
	render(Harness, { viewMode: "kanban", desktop: adapter({ moveTodoOnBoard }) });
	const unassigned = page.getByRole("region", { name: "Unassigned", exact: true });
	await keyboardBoardMove("in-progress");
	await expect.element(unassigned.getByRole("button", { name: "Open Plan release" })).toBeVisible();
	await expect.element(page.getByText("Could not move Todo item")).toBeVisible();
	expect(moveTodoOnBoard).toHaveBeenCalledOnce();
});

test("a pending board move does not steal focus if the user moves elsewhere", async () => {
	await page.viewport(1400, 900);
	const response = Promise.withResolvers<Awaited<ReturnType<DesktopAPI["moveTodoOnBoard"]>>>();
	render(Harness, {
		viewMode: "kanban",
		desktop: adapter({ moveTodoOnBoard: () => response.promise }),
	});
	await keyboardBoardMove("to-do");
	const other = page.getByRole("region", { name: "Kanban board" });
	(other.element() as HTMLElement).focus();
	const moved = {
		...todo,
		raw: `${todo.raw} board:to-do`,
		metadata: { board: "to-do" },
		edit: { ...todo.edit, metadata: ["board:to-do"] },
	};
	response.resolve({ status: "applied", confirmed: confirmedTodo([moved]) });
	await expect
		.element(
			page
				.getByRole("region", { name: "To do", exact: true })
				.getByRole("button", { name: "Open Plan release" })
		)
		.toBeVisible();
	await expect.element(other).toHaveFocus();
});

test("a conflicting board move displays the refreshed Todo item without retrying", async () => {
	await page.viewport(1400, 900);
	const changed = {
		...todo,
		raw: "Externally changed board:in-progress",
		description: "Externally changed",
		metadata: { board: "in-progress" },
		edit: { description: "Externally changed", metadata: ["board:in-progress"] },
	};
	const moveTodoOnBoard = vi.fn<DesktopAPI["moveTodoOnBoard"]>(async () => ({
		status: "conflict",
		message: "Changed on disk",
		confirmed: confirmedTodo([changed]),
	}));
	render(Harness, { viewMode: "kanban", desktop: adapter({ moveTodoOnBoard }) });
	await keyboardBoardMove("to-do");
	await expect
		.element(
			page
				.getByRole("region", { name: "In progress" })
				.getByRole("button", { name: "Open Externally changed" })
		)
		.toBeVisible();
	await expect.element(page.getByText("Todo file changed")).toBeVisible();
	expect(moveTodoOnBoard).toHaveBeenCalledOnce();
});

test("Kanban cards open the existing details and completion follows confirmed Workspace data", async () => {
	await page.viewport(1400, 900);
	const completed = {
		...todo,
		completed: true,
		completion_date: "2026-10-14",
		raw: "x 2026-10-14 Plan release +Work",
	};
	const setTodoCompletion = vi.fn<DesktopAPI["setTodoCompletion"]>(async () => ({
		status: "applied",
		confirmed: confirmedTodo([completed]),
	}));
	render(Harness, { viewMode: "kanban", desktop: adapter({ setTodoCompletion }) });
	const unassigned = page.getByRole("region", { name: "Unassigned" });
	const done = page.getByRole("region", { name: "Done" });
	await unassigned.getByRole("button", { name: "Open Plan release" }).click();
	const details = page.getByRole("complementary", { name: "Todo item details" });
	await expect.element(details.getByRole("heading", { name: "Plan release" })).toBeVisible();
	await unassigned.getByRole("checkbox", { name: "Mark Plan release complete" }).click();
	await expect.element(done.getByRole("button", { name: "Open Plan release" })).toBeVisible();
	await expect.element(details.getByRole("button", { name: "Mark incomplete" })).toBeVisible();
	await details.getByRole("button", { name: "Close details" }).click();
	await expect.element(done.getByRole("button", { name: "Open Plan release" })).toHaveFocus();
	expect(setTodoCompletion).toHaveBeenCalledExactlyOnceWith({
		scope,
		revision: 1,
		workspaceId,
		lineNumber: 1,
		expectedRaw: "Plan release +Work",
		completed: true,
	});
});

test("Kanban checkbox and item expose separate keyboard actions", async () => {
	await page.viewport(1400, 900);
	const completed = {
		...todo,
		completed: true,
		completion_date: "2026-10-14",
		raw: "x 2026-10-14 Plan release +Work",
	};
	const setTodoCompletion = vi.fn<DesktopAPI["setTodoCompletion"]>(async () => ({
		status: "applied",
		confirmed: confirmedTodo([completed]),
	}));
	render(Harness, { viewMode: "kanban", desktop: adapter({ setTodoCompletion }) });
	const checkbox = page.getByRole("checkbox", { name: "Mark Plan release complete" });
	await expect.element(checkbox).toBeEnabled();
	(checkbox.element() as HTMLElement).focus();
	await userEvent.keyboard("{Space}");
	const completedCheckbox = page.getByRole("checkbox", { name: "Mark Plan release incomplete" });
	await expect.element(completedCheckbox).toBeChecked();
	await expect.element(completedCheckbox).toHaveFocus();
	const details = page.getByRole("complementary", { name: "Todo item details" });
	await expect.element(details).not.toBeInTheDocument();

	const open = page.getByRole("button", { name: "Open Plan release" });
	await expect.element(open).toHaveAttribute("aria-expanded", "false");
	(open.element() as HTMLElement).focus();
	await userEvent.keyboard("{Enter}");
	await expect.element(details.getByRole("heading", { name: "Plan release" })).toBeVisible();
	await expect.element(open).toHaveAttribute("aria-expanded", "true");
	expect(setTodoCompletion).toHaveBeenCalledOnce();
});

test("a rejected Kanban completion keeps the confirmed card and reports the failure", async () => {
	const setTodoCompletion = vi.fn<DesktopAPI["setTodoCompletion"]>(async () => ({
		status: "rejected",
		message: "Todo file is read-only",
	}));
	render(Harness, { viewMode: "kanban", desktop: adapter({ setTodoCompletion }) });
	const unassigned = page.getByRole("region", { name: "Unassigned" });
	const checkbox = unassigned.getByRole("checkbox", { name: "Mark Plan release complete" });
	await checkbox.click();
	await expect.element(page.getByText("Could not update Todo item")).toBeVisible();
	await expect.element(page.getByText("Todo file is read-only")).toBeVisible();
	await expect.element(checkbox).not.toBeChecked();
	await expect.element(unassigned.getByRole("button", { name: "Open Plan release" })).toBeVisible();
	expect(setTodoCompletion).toHaveBeenCalledTimes(1);
});

test("sidebar filters narrow Kanban cards using the same Workspace data", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	await page.viewport(1400, 900);
	const personal = {
		...todo,
		line_number: 2,
		raw: "Read a book +Home",
		description: "Read a book",
		projects: ["Home"],
		edit: { description: "Read a book", metadata: [] },
	};
	const session = {
		...initial,
		session: {
			...initial.session,
			todo_file: { ...initial.session.todo_file, items: [todo, personal] },
		},
	};
	render(Harness, {
		viewMode: "kanban",
		shell: true,
		desktop: adapter({ readSession: async () => session }),
	});
	await expect.element(page.getByRole("button", { name: "Open Read a book" })).toBeVisible();
	await page.getByRole("button", { name: "+Work", exact: true }).click();
	await expect.element(page.getByRole("button", { name: "Open Plan release" })).toBeVisible();
	await expect
		.element(page.getByRole("button", { name: "Open Read a book" }))
		.not.toBeInTheDocument();
});
function boardSession(items: TodoFile["items"]) {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	return {
		...initial,
		session: { ...initial.session, todo_file: { ...initial.session.todo_file, items } },
	};
}
const hiddenPersonal = {
	...todo,
	line_number: 2,
	raw: "Read a book +Home",
	description: "Read a book",
	projects: ["Home"],
	edit: { description: "Read a book", metadata: [] },
};
const notes = {
	...todo,
	line_number: 3,
	raw: "Write notes +Work",
	description: "Write notes",
	edit: { description: "Write notes", metadata: [] },
};
const cardOrder = () =>
	page
		.getByRole("list", { name: "Unassigned cards" })
		.getByRole("listitem")
		.elements()
		.map((element) => element.getAttribute("aria-label"));

test("filtered Kanban reordering sends only displayed cards and offers Undo", async () => {
	await page.viewport(1400, 900);
	const response = Promise.withResolvers<Awaited<ReturnType<DesktopAPI["reorderTodosOnBoard"]>>>();
	const reorderTodosOnBoard = vi.fn<DesktopAPI["reorderTodosOnBoard"]>(() => response.promise);
	render(Harness, {
		viewMode: "kanban",
		shell: true,
		desktop: adapter({
			readSession: async () => boardSession([todo, hiddenPersonal, notes]),
			reorderTodosOnBoard,
		}),
	});
	await page.getByRole("button", { name: "+Work", exact: true }).click();
	await expect.poll(cardOrder).toEqual(["Plan release", "Write notes"]);
	(page.getByRole("listitem", { name: "Write notes" }).element() as HTMLElement).focus();
	await userEvent.keyboard("{Space}{ArrowUp}{Space}");
	await expect.poll(() => reorderTodosOnBoard.mock.calls.length).toBe(1);
	expect(reorderTodosOnBoard).toHaveBeenCalledWith({
		scope,
		revision: 1,
		workspaceId,
		column: "unassigned",
		targets: [
			{ lineNumber: 3, expectedRaw: notes.raw },
			{ lineNumber: 1, expectedRaw: todo.raw },
		],
	});
	// The confirmed order stays visible until the write is confirmed.
	await expect.poll(cardOrder).toEqual(["Plan release", "Write notes"]);
	const positioned = (item: typeof todo, position: number) => ({
		...item,
		raw: `${item.raw} board:unassigned/${position}`,
		metadata: { board: `unassigned/${position}` },
		edit: { ...item.edit, metadata: [`board:unassigned/${position}`] },
	});
	response.resolve({
		status: "applied",
		confirmed: {
			...confirmedTodo([positioned(todo, 2), positioned(hiddenPersonal, 1), positioned(notes, 0)]),
			undoLabel: "Undo reordering",
		},
	});
	await expect.poll(cardOrder).toEqual(["Write notes", "Plan release"]);
	await expect.element(page.getByRole("button", { name: "Undo reordering" })).toBeEnabled();
});

test("a failed Kanban reordering keeps the confirmed order and reports the error", async () => {
	await page.viewport(1400, 900);
	const reorderTodosOnBoard = vi.fn<DesktopAPI["reorderTodosOnBoard"]>(async () => ({
		status: "rejected",
		message: "Write failed",
	}));
	render(Harness, {
		viewMode: "kanban",
		desktop: adapter({
			readSession: async () => boardSession([todo, notes]),
			reorderTodosOnBoard,
		}),
	});
	await expect.poll(cardOrder).toEqual(["Plan release", "Write notes"]);
	(page.getByRole("listitem", { name: "Plan release" }).element() as HTMLElement).focus();
	await userEvent.keyboard("{Space}{ArrowDown}{Space}");
	await expect.element(page.getByText("Could not reorder Todo items")).toBeVisible();
	expect(cardOrder()).toEqual(["Plan release", "Write notes"]);
	expect(reorderTodosOnBoard).toHaveBeenCalledOnce();
});

test("Due-date sorting changes only the view and restores reordering in File order", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const ready = initial.session;
	const items = [
		{ ...todo, metadata: { due: "2026-11-01" } },
		{
			...todo,
			line_number: 2,
			raw: "Earlier due:2026-10-14",
			description: "Earlier",
			metadata: { due: "2026-10-14" },
		},
	];
	const reorderTodo = vi
		.fn<DesktopAPI["reorderTodo"]>()
		.mockResolvedValue({ status: "rejected", message: "unused" });
	render(Harness, {
		desktop: adapter({
			readSession: async () =>
				({
					...initial,
					session: {
						...initial.session,
						todo_file: { path: "/tmp/work.todo", items, skipped: [] },
					},
				}) as ConfirmedSession,
			reorderTodo,
			setWorkspaceSortOrder: async (request) => ({
				status: "applied",
				confirmed: {
					...initial,
					revision: request.revision + 1,
					session: {
						...initial.session,
						status: "ready",
						catalogue: {
							...ready.catalogue,
							workspaces: ready.catalogue.workspaces.map((w) => ({
								...w,
								sort_order: request.sortOrder,
							})),
						},
						todo_file: { path: "/tmp/work.todo", items, skipped: [] },
					},
				} as ConfirmedSession,
			}),
		}),
	});
	await expect.element(page.getByRole("listitem").nth(0)).toMatchTextContent("Plan release");
	await page.getByRole("button", { name: "Sort Todo items" }).click();
	await page.getByRole("menuitemradio", { name: "Due date", exact: true }).click();
	await expect.element(page.getByRole("listitem").nth(0)).toMatchTextContent("Earlier");
	await expect
		.element(page.getByRole("button", { name: "Sort Todo items" }))
		.toHaveAttribute("title", "Sort: Due date");
	await expect
		.element(page.getByRole("button", { name: "Reorder Earlier", exact: true }))
		.not.toBeInTheDocument();
	expect(reorderTodo).not.toHaveBeenCalled();
	await page.getByRole("button", { name: "Sort Todo items" }).click();
	await expect
		.element(page.getByRole("menuitemradio", { name: "Due date", exact: true }))
		.toHaveAttribute("aria-checked", "true");
	await page.getByRole("menuitemradio", { name: "File order", exact: true }).click();
	await expect.element(page.getByRole("listitem").nth(0)).toMatchTextContent("Plan release");
	await expect
		.element(page.getByRole("button", { name: "Reorder Earlier", exact: true }))
		.toBeVisible();
	expect(items.map((item) => item.line_number)).toEqual([1, 2]);
});
test("restores the Workspace sort choice and retains it when saving fails", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const ready = initial.session;
	render(Harness, {
		desktop: adapter({
			readSession: async () => ({
				...initial,
				session: {
					...ready,
					catalogue: {
						...ready.catalogue,
						workspaces: ready.catalogue.workspaces.map((w) => ({ ...w, sort_order: "due" })),
					},
				},
			}),
			setWorkspaceSortOrder: async () => ({ status: "rejected", message: "Disk is read-only" }),
		}),
	});
	await expect
		.element(page.getByRole("button", { name: "Sort Todo items" }))
		.toHaveAttribute("title", "Sort: Due date");
	await page.getByRole("button", { name: "Sort Todo items" }).click();
	await page.getByRole("menuitemradio", { name: "File order", exact: true }).click();
	await expect.element(page.getByText("Could not save sort order", { exact: true })).toBeVisible();
	await expect
		.element(page.getByRole("button", { name: "Sort Todo items" }))
		.toHaveAttribute("title", "Sort: Due date");
});
test("detail completion and editing use confirmed results and deletion closes the panel", async () => {
	await page.viewport(1400, 900);
	const completed = {
		...todo,
		completed: true,
		completion_date: "2026-10-14",
		raw: "x 2026-10-14 Plan release +Work",
	};
	const edited = {
		...completed,
		raw: "x 2026-10-14 Updated +Work",
		description: "Updated",
		edit: { description: "Updated", metadata: [] },
	};
	let revision = 1;
	const setTodoCompletion = vi.fn(async () => ({
		status: "applied" as const,
		confirmed: { ...confirmedTodo([completed]), revision: ++revision },
	}));
	const editTodo = vi.fn(async () => ({
		status: "applied" as const,
		confirmed: { ...confirmedTodo([edited]), revision: ++revision },
	}));
	render(Harness, {
		desktop: adapter({
			setTodoCompletion,
			editTodo,
			deleteTodo: async () => ({
				status: "applied",
				confirmed: { ...confirmedTodo([]), revision: ++revision },
			}),
		}),
	});
	await page.getByRole("button", { name: "Navigate Plan release", exact: true }).click();
	const panel = page.getByRole("complementary", { name: "Todo item details" });
	await panel.getByRole("button", { name: "Mark complete", exact: true }).click();
	await expect
		.element(panel.getByRole("button", { name: "Mark incomplete", exact: true }))
		.toBeVisible();
	await expect.element(panel.getByText("2026-10-14", { exact: true }).first()).toBeVisible();
	expect(setTodoCompletion).toHaveBeenCalledTimes(1);
	await panel.getByRole("button", { name: "Edit", exact: true }).click();
	await page.getByRole("textbox", { name: /Description/ }).fill("Updated");
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect.element(panel.getByRole("heading", { name: "Updated", exact: true })).toBeVisible();
	await expect.element(panel.getByRole("button", { name: "Edit", exact: true })).toHaveFocus();
	expect(editTodo).toHaveBeenCalledTimes(1);
	await panel.getByRole("button", { name: "Detail actions", exact: true }).click();
	await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
	await expect.element(panel).not.toBeInTheDocument();
});

test("an external replacement clears details and cannot reopen a reused physical line", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	await page.viewport(1400, 900);
	let loads = 0;
	let notify!: (change: TodoFileChange) => void;
	render(Harness, {
		desktop: adapter({
			readSession: async () =>
				({
					...initial,
					revision: ++loads,
					session: {
						...initial.session,
						todo_file: {
							path: "/tmp/work.todo",
							items: [
								loads === 2 ? { ...todo, raw: "Replacement", description: "Replacement" } : todo,
							],
							skipped: [],
						},
					},
				}) as ConfirmedSession,
		}),
		observation: {
			onTodoFileChanged(listener) {
				notify = listener;
				return () => {};
			},
		},
	});
	await page.getByRole("button", { name: "Navigate Plan release", exact: true }).click();
	const panel = page.getByRole("complementary", { name: "Todo item details" });
	await expect.element(panel).toBeVisible();
	notify({ scope, revision: 2, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.element(page.getByText("Replacement", { exact: true })).toBeVisible();
	await expect.element(panel).not.toBeInTheDocument();
	notify({ scope, revision: 3, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.element(page.getByText("Plan release", { exact: true })).toBeVisible();
	await expect.element(panel).not.toBeInTheDocument();
});

test("idle observation updates the list, counts, facets, and skipped lines with one info notice", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const refreshed: ConfirmedSession = {
		...initial,
		revision: 2,
		session: {
			...initial.session,
			todo_file: {
				path: "/tmp/work.todo",
				items: [
					{
						...todo,
						raw: "(B) New item +Home @desk",
						description: "New item",
						priority: "B",
						projects: ["Home"],
						contexts: ["desk"],
					},
					{
						...todo,
						line_number: 2,
						raw: "x Finished",
						description: "Finished",
						completed: true,
						projects: [],
					},
				],
				skipped: [{ line_number: 3, raw: "x", reason: "Missing description" }],
			},
		},
	};
	let loads = 0;
	let notify!: (event: TodoFileChange) => void;
	render(Harness, {
		desktop: adapter({ readSession: async () => (loads++ ? refreshed : initial) }),
		observation: {
			onTodoFileChanged(listener) {
				notify = listener;
				return () => {};
			},
		},
	});
	await expect.element(page.getByText("Plan release", { exact: true })).toBeVisible();
	notify({ scope, revision: 2, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.element(page.getByText("New item", { exact: true })).toBeVisible();
	await expect.element(page.getByText("Plan release", { exact: true })).not.toBeInTheDocument();
	await expect.element(page.getByLabelText("Summary counts")).toHaveTextContent("1/1");
	await expect.element(page.getByLabelText("Filter projects")).toHaveTextContent("Home");
	await expect.element(page.getByLabelText("Reader status")).toMatchTextContent("1 skipped line");
	await expect
		.poll(() => document.querySelectorAll('[data-sonner-toast][data-type="info"]').length)
		.toBe(1);
	expect(document.querySelectorAll('[data-sonner-toast][data-type="error"]').length).toBe(0);
});

test("conflict recovery and delayed observation never stack error and info notices", async () => {
	let notify!: (event: TodoFileChange) => void;
	const latest = confirmedTodo([{ ...todo, raw: "Edited", description: "Edited" }]);
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const refreshed: ConfirmedSession = {
		...initial,
		revision: 3,
		session: { ...initial.session, todo_file: latest.todo_file },
	};
	let loads = 0;
	render(Harness, {
		desktop: adapter({
			readSession: async () => (loads++ ? refreshed : initial),
			setTodoCompletion: async () => {
				notify({ scope, revision: 1, workspaceId, todoPath: "/tmp/work.todo" });
				return { status: "conflict", message: "changed", confirmed: latest };
			},
		}),
		observation: {
			onTodoFileChanged(listener) {
				notify = listener;
				return () => {};
			},
		},
	});
	expect(toast.getActiveToasts()).toHaveLength(0);
	await page.getByRole("checkbox", { name: "Mark Plan release complete" }).click();
	await expect.element(page.getByText("Edited", { exact: true })).toBeVisible();
	notify({ scope, revision: 2, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.element(page.getByText("Todo file changed")).toBeVisible();
	expect(document.querySelectorAll('[data-sonner-toast][data-type="info"]').length).toBe(0);
	expect(document.querySelectorAll('[data-sonner-toast][data-type="error"]').length).toBe(1);
});
test("accepted completion keeps the item checked in the default All view", async () => {
	let finish!: (result: Awaited<ReturnType<DesktopAPI["setTodoCompletion"]>>) => void;
	render(Harness, {
		desktop: adapter({
			setTodoCompletion: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		}),
	});
	const checkbox = page.getByRole("checkbox", { name: "Mark Plan release complete" });
	await expect.element(checkbox).toBeVisible();
	const originalCheckbox = document.querySelector('[role="checkbox"]');
	const list = document.querySelector('ul[aria-label="Todo items"]')!;
	const initialTop = list.getBoundingClientRect().top;
	await checkbox.click();
	await expect.element(checkbox).toBeDisabled();
	await expect.element(checkbox).not.toBeChecked();
	await expect.element(page.getByText("Updating Todo file…")).toBeVisible();
	const pendingTop = list.getBoundingClientRect().top;
	await expect.element(page.getByLabelText("Summary counts")).toHaveTextContent("1/0");
	finish({
		status: "applied",
		confirmed: confirmedTodo([
			{
				...todo,
				completed: true,
				raw: "x 2026-07-18 Plan release +Work",
				completion_date: "2026-07-18",
			},
		]),
	});
	await expect
		.element(page.getByRole("checkbox", { name: "Mark Plan release incomplete" }))
		.toBeChecked();
	await expect.element(page.getByLabelText("Summary counts")).toHaveTextContent("0/1");
	expect({
		pendingShift: pendingTop - initialTop,
		confirmedShift: 0,
		sameCheckbox: document.querySelector('[role="checkbox"]') === originalCheckbox,
	}).toEqual({ pendingShift: 0, confirmedShift: 0, sameCheckbox: true });
});
test("conflicts display current confirmed content and an external edit notice", async () => {
	render(Harness, {
		desktop: adapter({
			setTodoCompletion: async () => ({
				status: "conflict",
				message: "changed",
				confirmed: confirmedTodo([
					{
						...todo,
						raw: "Plan release carefully",
						description: "Plan release carefully",
						projects: [],
					},
				]),
			}),
		}),
	});
	await page.getByRole("checkbox", { name: "Mark Plan release complete" }).click();
	await expect.element(page.getByText("Plan release carefully")).toBeVisible();
	await expect.element(page.getByText("Todo file changed")).toBeVisible();
	await expect.element(page.getByLabelText("Filter projects")).toHaveTextContent("");
});
test("rejected deletion preserves confirmed content and reports its contextual error", async () => {
	render(Harness, {
		desktop: adapter({
			deleteTodo: async () => ({ status: "rejected", message: "permission denied" }),
		}),
	});
	await page.getByRole("button", { name: "Actions for Plan release" }).click();
	await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
	await expect.element(page.getByText("Plan release", { exact: true })).toBeVisible();
	await expect.element(page.getByText("Could not delete Todo item")).toBeVisible();
	await expect.element(page.getByText("permission denied")).toBeVisible();
});
test("duplicate creation submissions keep dismissal blocked until the admitted save settles", async () => {
	let calls = 0;
	let finish!: (result: Awaited<ReturnType<DesktopAPI["createTodo"]>>) => void;
	render(Harness, {
		desktop: adapter({
			createTodo: () => {
				calls++;
				return new Promise((resolve) => {
					finish = resolve;
				});
			},
		}),
	});
	const trigger = page.getByRole("button", { name: "Add Todo item", exact: true }).nth(0);
	await trigger.click();
	const description = page.getByPlaceholder("What needs doing?");
	await description.fill("Keep this draft");
	const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')!;
	form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
	form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
	await expect.poll(() => calls).toBe(1);
	const close = page.getByRole("button", { name: "Close", exact: true });
	await expect.element(close).toBeDisabled();
	await expect.element(description).toBeDisabled();
	await expect.element(page.getByPlaceholder("Choose or create a Project")).toBeDisabled();
	await expect.element(page.getByPlaceholder("Choose or create a Context")).toBeDisabled();
	await expect.element(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
	expect(
		document.querySelector<HTMLButtonElement>('button[aria-label="Actions for Plan release"]')
			?.disabled
	).toBe(true);
	(close.element() as HTMLButtonElement).click();
	await userEvent.keyboard("{Escape}");
	await expect.element(page.getByRole("dialog")).toBeVisible();
	await expect.element(description).toHaveValue("Keep this draft");
	finish({ status: "rejected", message: "Creation blocked by permissions" });
	await expect.element(description).toBeEnabled();
	await expect.element(page.getByText("Creation blocked by permissions")).toBeVisible();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect.element(trigger).toHaveFocus();
});

test("creation updates confirmed items, counts, and suggestions without moving the list, then resets and restores focus", async () => {
	if (initial.session.status !== "ready") throw Error("No initial file");
	const items = Array.from({ length: 40 }, (_, index) => ({
		...todo,
		line_number: index + 1,
		raw: `Existing item ${index} +Work`,
		description: `Existing item ${index}`,
	}));
	const loaded: ConfirmedSession = {
		...initial,
		session: { ...initial.session, todo_file: { ...initial.session.todo_file, items } },
	};
	const created = {
		...todo,
		line_number: 41,
		raw: "2026-10-09 Ship the release +work @Desk",
		description: "Ship the release",
		creation_date: "2026-10-09",
		priority: "Z",
		metadata: { custom: "value" },
		projects: ["work"],
		contexts: ["Desk"],

		edit: { description: "Ship the release", metadata: ["custom:value"] },
	};
	let request: Parameters<DesktopAPI["createTodo"]>[0] | undefined;
	render(Harness, {
		desktop: adapter({
			readSession: async () => loaded,
			createTodo: async (input) => {
				request = input;
				return { status: "applied", confirmed: confirmedTodo([...items, created]) };
			},
		}),
	});
	const trigger = page.getByRole("button", { name: "Add Todo item", exact: true }).nth(0);
	await expect.element(trigger).toBeEnabled();
	const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
	viewport.scrollTop = 200;
	expect(viewport.scrollTop).toBe(200);
	await trigger.click();
	const description = page.getByPlaceholder("What needs doing?");
	await expect.element(description).toHaveFocus();
	await expect.element(page.getByText("Work · work.todo", { exact: true })).toBeVisible();
	const submit = page.getByRole("button", { name: "Add Todo item", exact: true }).nth(1);
	await page.getByRole("button", { name: "Clear Creation date" }).click();
	await description.fill("   ");
	await submit.click();
	await expect
		.element(page.getByText("Enter a Description or another Todo-item value."))
		.toBeVisible();
	await expect.element(submit).toBeEnabled();
	await description.fill("  Ship   the release  ");
	await page.getByRole("button", { name: "Creation date", exact: true }).click();
	const monthsFromOctober = (new Date().getFullYear() - 2026) * 12 + new Date().getMonth() - 9;
	for (let month = 0; month < Math.abs(monthsFromOctober); month++) {
		await page
			.getByRole("button", { name: monthsFromOctober > 0 ? "Previous" : "Next", exact: true })
			.click();
	}
	await expect
		.element(page.getByRole("combobox", { name: "Select a month" }))
		.not.toBeInTheDocument();
	await page.getByRole("button", { name: /Friday, October 9, 2026/ }).click();
	await page.getByRole("button", { name: "Creation date", exact: true }).click();
	await page.getByRole("button", { name: "Other", exact: true }).click();
	await page.getByRole("textbox", { name: "Other priority" }).fill("z");
	const metadata = page.getByPlaceholder("Add key:value");
	await metadata.fill("custom:value");
	metadata.element().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	const projects = page.getByPlaceholder("Choose or create a Project");
	await projects.fill("+work");
	await expect.element(page.getByRole("option", { name: "Work", exact: true })).toBeVisible();
	projects.element().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	const contexts = page.getByPlaceholder("Choose or create a Context");
	await contexts.fill("@Desk");
	contexts.element().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	await submit.click();
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	await expect.element(trigger).toHaveFocus();
	expect(request).toEqual({
		scope,
		revision: 1,
		workspaceId,
		description: "Ship the release",
		projects: ["work"],
		contexts: ["Desk"],
		priority: "Z",
		creationDate: "2026-10-09",
		completed: false,
		completionDate: null,
		metadata: ["custom:value"],
	});
	await expect.element(page.getByLabelText("Summary counts")).toHaveTextContent("41/0");
	await expect.element(page.getByLabelText("Filter projects")).toHaveTextContent("work,Work");
	expect(viewport.scrollTop).toBe(200);
	// The appended item becomes available when scrolled into the virtual viewport.
	viewport.scrollTop = viewport.scrollHeight;
	await expect.element(page.getByText("Ship the release", { exact: true })).toBeVisible();
	expect(document.querySelector('[data-sonner-toast][data-type="success"]')).toBeNull();
	await trigger.click();
	await expect.element(description).toHaveFocus();
	await expect.element(description).toHaveValue("");
	await projects.click();
	await expect.element(page.getByRole("option", { name: "work", exact: true })).toBeVisible();
	await expect.element(page.getByRole("option", { name: "Work", exact: true })).toBeVisible();
	await contexts.click();
	await expect.element(page.getByRole("option", { name: "Desk", exact: true })).toBeVisible();
});

test.each(["conflict", "rejected"] as const)(
	"creation %s retains the draft and cancellation discards it",
	async (status) => {
		render(Harness, {
			desktop: adapter({
				createTodo: async () =>
					status === "conflict"
						? {
								status,
								message: "Changed on disk",
								confirmed: confirmedTodo([{ ...todo, projects: ["External"] }]),
							}
						: { status, message: "Permission denied" },
			}),
		});
		const trigger = page.getByRole("button", { name: "Add Todo item", exact: true }).nth(0);
		await trigger.click();
		const description = page.getByPlaceholder("What needs doing?");
		await description.fill("Retain this draft");
		const projects = page.getByPlaceholder("Choose or create a Project");
		await projects.fill("Draft");
		projects.element().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		await page.getByRole("button", { name: "Add Todo item", exact: true }).nth(1).click();
		await expect.element(description).toBeEnabled();
		await expect.element(description).toHaveValue("Retain this draft");
		await expect.element(page.getByText("+Draft", { exact: true })).toBeVisible();
		await expect
			.element(
				page.getByText(status === "conflict" ? "Todo file changed" : "Permission denied").last()
			)
			.toBeVisible();
		if (status === "conflict") {
			await projects.click();
			await expect
				.element(page.getByRole("option", { name: "External", exact: true }))
				.toBeVisible();
			await expect
				.element(page.getByRole("option", { name: "Work", exact: true }))
				.not.toBeInTheDocument();
		}
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect.element(trigger).toHaveFocus();
		await trigger.click();
		await expect.element(description).toHaveValue("");
		await expect.element(page.getByText("+Draft", { exact: true })).not.toBeInTheDocument();
	}
);

test("a keyboard drop keeps confirmed order while saving and follows selected details", async () => {
	await page.viewport(1400, 900);
	const second = { ...todo, line_number: 3, raw: "Ship", description: "Ship" };
	const hidden = {
		...todo,
		line_number: 2,
		raw: "x 2026-10-10 Hidden",
		description: "Hidden",
		completed: true,
	};
	if (initial.session.status !== "ready") throw Error("Expected Ready session");
	const snapshot: ConfirmedSession = {
		...initial,
		session: {
			...initial.session,
			todo_file: { ...initial.session.todo_file, items: [todo, hidden, second] },
		},
	};
	let input: Parameters<DesktopAPI["reorderTodo"]>[0] | undefined;
	let finish!: (outcome: Awaited<ReturnType<DesktopAPI["reorderTodo"]>>) => void;
	render(Harness, {
		desktop: adapter({
			readSession: async () => snapshot,
			reorderTodo: (request) => {
				input = request;
				return new Promise((resolve) => {
					finish = resolve;
				});
			},
		}),
	});
	await page.getByRole("button", { name: "Navigate Plan release", exact: true }).click();
	const panel = page.getByRole("complementary", { name: "Todo item details" });
	await expect
		.element(panel.getByRole("heading", { name: "Plan release", exact: true }))
		.toBeVisible();
	const handle = page.getByRole("button", { name: "Reorder Plan release", exact: true });
	await expect.element(handle).toBeVisible();
	(handle.element() as HTMLElement).focus();
	await userEvent.keyboard("{Space}{ArrowDown}{Space}");
	await expect
		.poll(() => input)
		.toEqual({ scope, revision: 1, workspaceId, lineNumbers: [2, 1, 3] });
	await expect.element(handle).toBeDisabled();
	await expect
		.element(panel.getByRole("heading", { name: "Plan release", exact: true }))
		.toBeVisible();
	await expect.element(page.getByRole("listitem").nth(0)).toMatchTextContent("Plan release");
	finish({
		status: "applied",
		confirmed: confirmedTodo([{ ...hidden, line_number: 1 }, { ...todo, line_number: 2 }, second]),
	});
	await expect.element(page.getByRole("listitem").nth(0)).toMatchTextContent("Hidden");
	await expect.element(handle).not.toBeDisabled();
	await expect
		.element(panel.getByRole("heading", { name: "Plan release", exact: true }))
		.toBeVisible();
	await panel.getByRole("button", { name: "Close details", exact: true }).click();
	await expect
		.element(page.getByRole("button", { name: "Navigate Plan release", exact: true }))
		.toHaveFocus();
});

test("editing a Todo item updates search results while preserving the query", async () => {
	await render(Harness, {
		desktop: adapter({
			editTodo: async () => ({
				status: "applied",
				confirmed: confirmedTodo([
					{ ...todo, raw: "Ship release +Work", description: "Ship release" },
				]),
			}),
		}),
	});
	const search = page.getByRole("searchbox", { name: "Search Todo items" });
	await page.getByRole("button", { name: "Toggle Todo-item search" }).click();
	await search.fill("plan");
	await page.getByRole("button", { name: "Actions for Plan release", exact: true }).click();
	await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("textbox", { name: /Description/ }).fill("Ship release");
	await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect.element(page.getByLabelText("No matching Todo items")).toBeVisible();
	await expect.element(search).toHaveValue("plan");
	await search.fill("ship");
	await expect.element(page.getByText("Ship release", { exact: true })).toBeVisible();
});

test("external reload updates search results while preserving the query", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const ready = initial.session;
	let notify!: (change: TodoFileChange) => void;
	let loads = 0;
	const changed = { ...todo, raw: "Different content", description: "Different content" };
	await render(Harness, {
		desktop: adapter({
			readSession: async () => ({
				...initial,
				revision: ++loads,
				session: {
					...ready,
					todo_file: { ...ready.todo_file, items: [loads === 1 ? todo : changed] },
				},
			}),
		}),
		observation: {
			onTodoFileChanged(listener) {
				notify = listener;
				return () => {};
			},
		},
	});
	const search = page.getByRole("searchbox", { name: "Search Todo items" });
	await page.getByRole("button", { name: "Toggle Todo-item search" }).click();
	await search.fill("plan");
	await expect.element(page.getByText("Plan release", { exact: true })).toBeVisible();
	notify({ scope, revision: 2, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.element(page.getByLabelText("No matching Todo items")).toBeVisible();
	await expect.element(search).toHaveValue("plan");
	await search.fill("different");
	await expect.element(page.getByText("Different content", { exact: true })).toBeVisible();
});

test("row menu opens a prefilled edit form and saves through scoped Workspace commands", async () => {
	let request: Parameters<DesktopAPI["editTodo"]>[0] | undefined;
	let finish!: (value: Awaited<ReturnType<DesktopAPI["editTodo"]>>) => void;
	render(Harness, {
		desktop: adapter({
			editTodo: async (input) => {
				request = input;
				return new Promise((resolve) => {
					finish = resolve;
				});
			},
		}),
	});
	await page.getByRole("button", { name: "Actions for Plan release", exact: true }).click();
	await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await expect
		.element(dialog.getByRole("textbox", { name: /Description/ }))
		.toHaveValue("Plan release");
	await dialog.getByRole("textbox", { name: /Description/ }).fill("Ship release");
	await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
	expect(request).toMatchObject({
		scope,
		revision: 1,
		workspaceId,
		lineNumber: 1,
		expectedRaw: todo.raw,
		description: "Ship release",
		projects: ["Work"],
		contexts: [],
		creationDate: null,
		completed: false,
		completionDate: null,
	});
	await expect.element(dialog.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
	await expect.element(page.getByText("Plan release", { exact: true })).toBeInTheDocument();
	finish({
		status: "applied",
		confirmed: confirmedTodo([{ ...todo, raw: "Ship release +Work", description: "Ship release" }]),
	});
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	await expect.element(page.getByText("Ship release", { exact: true })).toBeInTheDocument();
});

test("canceling an edit restores row focus and does not save", async () => {
	let saves = 0;
	render(Harness, {
		desktop: adapter({
			editTodo: async () => {
				saves++;
				return { status: "rejected", message: "unused" };
			},
		}),
	});
	const trigger = page.getByRole("button", { name: "Actions for Plan release", exact: true });
	await trigger.click();
	await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
	await page.getByRole("textbox", { name: /Description/ }).fill("Discarded");
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	await expect.element(trigger).toHaveFocus();
	expect(saves).toBe(0);
});
test("keyboard creation reads current filters each time the dialog opens", async () => {
	await page.viewport(1200, 800);
	render(Harness, { desktop: adapter(), shell: true });
	await page.getByRole("button", { name: "+Work", exact: true }).click();
	const mod = navigator.platform.includes("Mac") ? "Meta" : "Control";
	await userEvent.keyboard(`{${mod}>}n{/${mod}}`);
	await expect
		.element(page.getByRole("button", { name: "Remove +Work", exact: true }))
		.toBeVisible();
	await expect.element(page.getByPlaceholder("What needs doing?")).toHaveFocus();
	await userEvent.keyboard("{Escape}");
	await page.getByRole("button", { name: "Clear Project Work", exact: true }).click();
	await userEvent.keyboard(`{${mod}>}n{/${mod}}`);
	await expect.element(page.getByRole("dialog", { name: "New Todo item" })).toBeVisible();
	await expect
		.element(page.getByRole("button", { name: "Remove +Work", exact: true }))
		.not.toBeInTheDocument();
});

test("shell shortcuts open existing surfaces, show hints, and suspend background bindings", async () => {
	await page.viewport(1200, 800);
	render(Harness, { desktop: adapter(), shell: true });
	await expect.element(page.getByText("Plan release", { exact: true })).toBeVisible();
	const mod = /Mac/i.test(navigator.platform) ? "Meta" : "Control";
	await userEvent.keyboard(`{${mod}>}p{/${mod}}`);
	await expect.element(page.getByRole("menu")).toBeVisible();
	await userEvent.keyboard(`{${mod}>}n{/${mod}}`);
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	await userEvent.keyboard("{Escape}");
	await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	await userEvent.keyboard(`{${mod}>}{Shift>}N{/Shift}{/${mod}}`);
	await expect.element(page.getByRole("dialog", { name: "Create workspace" })).toBeVisible();
	await userEvent.keyboard(`{${mod}>}b{/${mod}}`);
	expect(document.querySelector('[data-sidebar="sidebar"]')?.getAttribute("data-state")).not.toBe(
		"collapsed"
	);
	await userEvent.keyboard("{Escape}");
	await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	await userEvent.keyboard(`{${mod}>}n{/${mod}}`);
	await expect.element(page.getByRole("dialog", { name: "New Todo item" })).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click();
	await expect.element(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
	await expect.element(page.getByText("Open Workspace switcher", { exact: true })).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	await userEvent.keyboard(`{${mod}>}/{/${mod}}`);
	await expect.element(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});

test("a delayed completion respects focus moved to another control", async () => {
	let finish!: (result: Awaited<ReturnType<DesktopAPI["setTodoCompletion"]>>) => void;
	await page.viewport(1200, 800);
	render(Harness, {
		shell: true,
		desktop: adapter({
			setTodoCompletion: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		}),
	});
	await page.getByRole("button", { name: /^Open / }).click();
	const row = page.getByRole("button", { name: "Navigate Plan release", exact: true });
	await expect.element(row).toBeVisible();
	(row.element() as HTMLElement).focus();
	await userEvent.keyboard("{Space}");
	const fallback = document.querySelector<HTMLElement>(
		'[aria-label="Todo item results"] [data-slot="scroll-area-viewport"]'
	)!;
	fallback.focus();
	finish({ status: "applied", confirmed: confirmedTodo([{ ...todo, completed: true }]) });
	await expect.element(row).not.toBeInTheDocument();
	expect(document.activeElement).toBe(fallback);
});

test("external refresh retains unchanged row focus and sends uncertain identity to the list", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	let notify!: (change: TodoFileChange) => void;
	let loads = 0;
	const changed = { ...todo, raw: "Different content", description: "Different content" };
	render(Harness, {
		desktop: adapter({
			readSession: async () =>
				({
					...initial,
					revision: ++loads,
					session: {
						...initial.session,
						todo_file: { path: "/tmp/work.todo", items: [loads < 3 ? todo : changed], skipped: [] },
					},
				}) as ConfirmedSession,
		}),
		observation: {
			onTodoFileChanged(listener) {
				notify = listener;
				return () => {};
			},
		},
	});
	const row = page.getByRole("button", { name: "Navigate Plan release", exact: true });
	await expect.element(row).toBeVisible();
	(row.element() as HTMLElement).focus();
	notify({ scope, revision: 2, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.poll(() => loads).toBe(2);
	await expect.element(row).toHaveFocus();
	notify({ scope, revision: 3, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.element(page.getByText("Different content", { exact: true })).toBeVisible();
	await expect.element(page.getByRole("list", { name: "Todo items" })).toHaveFocus();
});

test("Workspace switching clears old navigation focus even when both files have the same line and content", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	await page.viewport(1200, 800);
	const secondId = "550e8400-e29b-41d4-a716-446655440001";
	const secondWorkspace = {
		...initial.session.catalogue.workspaces[0],
		id: secondId,
		name: "Home",
		todo_path: "/tmp/home.todo",
	};
	const catalogue = {
		...initial.session.catalogue,
		workspaces: [...initial.session.catalogue.workspaces, secondWorkspace],
	};
	let mutations = 0;
	render(Harness, {
		shell: true,
		desktop: adapter({
			readSession: async () =>
				({ ...initial, session: { ...initial.session, catalogue } }) as ConfirmedSession,
			switchWorkspace: async () => ({
				status: "applied",
				confirmed: {
					...initial,
					revision: 2,
					session: {
						...initial.session,
						catalogue: { ...catalogue, active_workspace_id: secondId },
						todo_file: { path: "/tmp/home.todo", items: [todo], skipped: [] },
					},
				} as ConfirmedSession,
			}),
			setTodoCompletion: async () => {
				mutations++;
				return { status: "rejected", message: "unused" };
			},
		}),
	});
	const row = page.getByRole("button", { name: "Navigate Plan release", exact: true });
	await expect.element(row).toBeVisible();
	(row.element() as HTMLElement).focus();
	const mod = /Mac/i.test(navigator.platform) ? "Meta" : "Control";
	await userEvent.keyboard(`{${mod}>}p{/${mod}}`);
	await page.getByRole("menuitem", { name: "Home", exact: true }).click();
	await expect.element(page.getByLabelText("Reader status")).toMatchTextContent("Workspace: Home");
	await expect.element(row).toHaveAttribute("tabindex", "-1");
	await userEvent.keyboard("{Space}");
	expect(mutations).toBe(0);
});

test("save, apply, and delete a Workspace-specific view through the desktop adapter", async () => {
	const views: import("@tuxedo/contracts").SavedView[] = [];
	render(Harness, {
		desktop: adapter({
			readSavedViews: async () => ({ status: "applied", workspaceId, views }),
			saveView: async (request) => {
				views.push({
					id: scope,
					workspace_id: request.workspaceId,
					name: request.name,
					filters: request.filters,
				});
				return { status: "applied", workspaceId, views: [...views] };
			},
			deleteView: async (request) => {
				expect(request).toEqual({ workspaceId, viewId: scope });
				views.splice(0);
				return { status: "applied", workspaceId, views: [] };
			},
		}),
	});
	await expect
		.element(page.getByRole("button", { name: "Saved views", exact: true }))
		.toBeEnabled();
	await page.getByRole("button", { name: "Toggle Todo-item search" }).click();
	await page.getByRole("searchbox", { name: "Search Todo items" }).fill("release");
	await page.getByRole("button", { name: "Saved views", exact: true }).click();
	await page.getByRole("button", { name: "Save current view", exact: true }).click();
	await page.getByRole("textbox", { name: "View name" }).fill("Release work");
	await page.getByRole("button", { name: "Save view", exact: true }).click();
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	expect(views[0]).toMatchObject({
		workspace_id: workspaceId,
		name: "Release work",
		filters: { status: "all", search: "release" },
	});
	await page.getByRole("button", { name: "Clear search", exact: true }).click();
	await page.getByRole("button", { name: "Saved views", exact: true }).click();
	await page.getByRole("button", { name: "Release work", exact: true }).click();
	await expect
		.element(page.getByRole("searchbox", { name: "Search Todo items" }))
		.toHaveValue("release");
	await page.getByRole("button", { name: "Saved views", exact: true }).click();
	await page.getByRole("button", { name: "Delete saved view Release work" }).click();
	await expect.element(page.getByText("No saved views yet.")).toBeVisible();
});

test.each([
	"Next occurrence due 2028-02-29.",
	"Unsupported Repeat rule; no next occurrence generated.",
])("checkbox completion shows backend feedback: %s", async (notice) => {
	const completed = {
		...todo,
		completed: true,
		raw: "x 2028-01-31 Plan release +Work rec:1m tuxedo-generated:1",
	};
	const next = {
		...todo,
		line_number: 2,
		raw: "2028-01-31 Plan release +Work rec:1m due:2028-02-29",
		creation_date: "2028-01-31",
		metadata: { rec: "1m", due: "2028-02-29" },
	};
	render(Harness, {
		desktop: adapter({
			setTodoCompletion: async () => ({
				status: "applied",
				confirmed: confirmedTodo([completed, next]),
				notice,
			}),
		}),
	});
	await page.getByRole("checkbox", { name: "Mark Plan release complete", exact: true }).click();
	await expect.element(page.getByText(notice, { exact: true })).toBeVisible();
	await expect.element(page.getByLabelText("Summary counts")).toHaveTextContent("1/1");
});

test("editor submits completion and saved recurrence together and shows successor feedback", async () => {
	let request: Parameters<DesktopAPI["editTodo"]>[0] | undefined;
	render(Harness, {
		desktop: adapter({
			editTodo: async (input) => {
				request = input;
				return {
					status: "applied",
					confirmed: confirmedTodo([{ ...todo, completed: true }]),
					notice: "Next occurrence due 2028-02-29.",
				};
			},
		}),
	});
	await page.getByRole("button", { name: "Actions for Plan release", exact: true }).click();
	await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
	await page.getByPlaceholder("Add key:value").fill("rec:1m");
	await userEvent.keyboard("{Enter}");
	await page.getByRole("checkbox", { name: "Completed", exact: true }).click();
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect.poll(() => request).toMatchObject({ completed: true, metadata: ["rec:1m"] });
	expect(request?.completionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	await expect
		.element(page.getByText("Next occurrence due 2028-02-29.", { exact: true }))
		.toBeVisible();
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

test("selection mode completes selected open Todo items through one bulk operation", async () => {
	const second: TodoFile["items"][number] = {
		...todo,
		line_number: 2,
		raw: "Write tests +Work",
		description: "Write tests",
		projects: ["Work"],
		edit: { description: "Write tests", metadata: [] },
	};
	const bulkSetTodoCompletion = vi.fn(async () => ({
		status: "applied" as const,
		confirmed: confirmedTodo([
			{
				...todo,
				completed: true,
				raw: "x 2026-07-18 Plan release +Work",
				completion_date: "2026-07-18",
			},
			{
				...second,
				completed: true,
				raw: "x 2026-07-18 Write tests +Work",
				completion_date: "2026-07-18",
			},
		]),
	}));
	render(Harness, {
		desktop: adapter({
			bulkSetTodoCompletion,
			readSession: async () => ({
				...initial,
				session: {
					...initial.session,
					todo_file: { path: "/tmp/work.todo", items: [todo, second], skipped: [] },
				},
			}),
		}),
	});
	await page.getByRole("button", { name: "Select items" }).click();
	await page.getByRole("checkbox", { name: "Select Plan release" }).click();
	await page.getByRole("checkbox", { name: "Select Write tests" }).click();
	await page.getByRole("button", { name: "Complete" }).click();
	expect(bulkSetTodoCompletion).toHaveBeenCalledTimes(1);
	await expect.element(page.getByText("Completed 2 Todo items", { exact: true })).toBeVisible();
	await expect.element(page.getByRole("button", { name: "Exit selection mode" })).toBeVisible();
});

test("a committed view change retires selection even while a Workspace operation is pending", async () => {
	await page.viewport(1400, 900);
	let finish!: (result: Awaited<ReturnType<DesktopAPI["setWorkspaceShowDeferred"]>>) => void;
	const setWorkspaceShowDeferred = vi.fn<DesktopAPI["setWorkspaceShowDeferred"]>(
		() => new Promise((resolve) => (finish = resolve))
	);
	const props = { desktop: adapter({ setWorkspaceShowDeferred }), viewMode: "list" as const };
	const view = await render(Harness, props);
	await page.getByRole("button", { name: "Select items", exact: true }).click();
	await page.getByRole("checkbox", { name: "Select Plan release", exact: true }).click();
	await view.rerender(props);
	await expect.element(page.getByText("1 selected", { exact: true })).toBeVisible();

	await page.getByRole("button", { name: "Show deferred", exact: true }).click();
	await expect.poll(() => setWorkspaceShowDeferred).toHaveBeenCalledOnce();
	await view.rerender({ ...props, viewMode: "kanban" });
	await expect.element(page.getByRole("region", { name: "Unassigned" })).toBeVisible();
	await view.rerender(props);
	await expect
		.element(page.getByRole("button", { name: "Select items", exact: true }))
		.toBeDisabled();
	await expect
		.element(page.getByRole("button", { name: "Exit selection mode" }))
		.not.toBeInTheDocument();

	finish({ status: "rejected", message: "Preference was not saved" });
	await expect
		.element(page.getByRole("button", { name: "Select items", exact: true }))
		.toBeEnabled();
});

test("unchanged refresh preserves deletion confirmation; changed contents dismiss it and require fresh selection", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const ready = initial.session;
	let notify!: (change: TodoFileChange) => void;
	let loads = 0;
	const bulkDeleteTodos = vi.fn<DesktopAPI["bulkDeleteTodos"]>();
	render(Harness, {
		desktop: adapter({
			bulkDeleteTodos,
			readSession: async () => ({
				...initial,
				revision: ++loads,
				session: {
					...ready,
					todo_file: {
						...ready.todo_file,
						skipped: loads < 3 ? [] : [{ line_number: 2, raw: "x", reason: "Invalid Todo item" }],
					},
				},
			}),
		}),
		observation: {
			onTodoFileChanged(listener) {
				notify = listener;
				return () => {};
			},
		},
	});
	await page.getByRole("button", { name: "Select items", exact: true }).click();
	await page.getByRole("checkbox", { name: "Select Plan release", exact: true }).click();
	await page.getByRole("button", { name: "Delete", exact: true }).click();
	notify({ scope, revision: 2, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.poll(() => loads).toBe(2);
	await expect
		.element(page.getByRole("alertdialog", { name: "Delete 1 Todo item?" }))
		.toBeVisible();
	await expect
		.element(page.getByRole("button", { name: "Delete Todo items", exact: true }))
		.toBeEnabled();
	notify({ scope, revision: 3, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
	await expect.element(page.getByText("0 selected", { exact: true })).toBeVisible();
	await expect
		.element(page.getByText("Selection cleared because the Todo file changed.", { exact: true }))
		.toBeVisible();
	await expect.element(page.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
	await expect
		.element(page.getByRole("button", { name: "Exit selection mode", exact: true }))
		.toHaveFocus();
	expect(bulkDeleteTodos).not.toHaveBeenCalled();
	await page.getByRole("checkbox", { name: "Select Plan release", exact: true }).click();
	await page.getByRole("button", { name: "Delete", exact: true }).click();
	await expect
		.element(page.getByRole("alertdialog", { name: "Delete 1 Todo item?" }))
		.toBeVisible();
});

test("an unchanged refresh allows the same confirmation to delete using the current revision", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const ready = initial.session;
	const second = { ...todo, line_number: 2, raw: "Second", description: "Second" };
	let notify!: (change: TodoFileChange) => void;
	let revision = 0;
	const bulkDeleteTodos = vi.fn<DesktopAPI["bulkDeleteTodos"]>(async () => ({
		status: "applied",
		confirmed: { ...confirmedTodo([todo]), revision: 3 },
	}));
	render(Harness, {
		desktop: adapter({
			bulkDeleteTodos,
			readSession: async () => ({
				...initial,
				revision: ++revision,
				session: { ...ready, todo_file: { ...ready.todo_file, items: [todo, second] } },
			}),
		}),
		observation: {
			onTodoFileChanged(listener) {
				notify = listener;
				return () => {};
			},
		},
	});
	await page.getByRole("button", { name: "Select items", exact: true }).click();
	await page.getByRole("checkbox", { name: "Select Second", exact: true }).click();
	await page.getByRole("button", { name: "Delete", exact: true }).click();
	notify({ scope, revision: 2, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.poll(() => revision).toBe(2);
	await expect
		.element(page.getByRole("button", { name: "Delete Todo items", exact: true }))
		.toBeEnabled();
	await page.getByRole("button", { name: "Delete Todo items", exact: true }).click();
	await expect
		.element(page.getByRole("button", { name: "Navigate Plan release", exact: true }))
		.toHaveFocus();
	expect(bulkDeleteTodos).toHaveBeenCalledExactlyOnceWith({
		scope,
		revision: 2,
		workspaceId,
		targets: [{ lineNumber: 2, expectedRaw: "Second" }],
	});
});

test("idle selection allows clearing active filters and clears the selection", async () => {
	await page.viewport(1200, 800);
	render(Harness, { shell: true, desktop: adapter() });
	await page.getByRole("button", { name: "+Work", exact: true }).click();
	await page.getByRole("button", { name: "Select items", exact: true }).click();
	await page.getByRole("checkbox", { name: "Select Plan release", exact: true }).click();
	await page.getByRole("button", { name: "Clear Project Work", exact: true }).click();
	await expect.element(page.getByText("0 selected", { exact: true })).toBeVisible();
	await expect
		.element(page.getByRole("button", { name: "Exit selection mode", exact: true }))
		.toBeVisible();
});

test("date and badge changes retain selection when the displayed population is unchanged", async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 18, 12));
	render(Harness, { desktop: adapter() });
	await page.getByRole("button", { name: "Select items", exact: true }).click();
	await page.getByRole("checkbox", { name: "Select Plan release", exact: true }).click();
	const row = page.getByRole("button", { name: "Navigate Plan release", exact: true });
	(row.element() as HTMLElement).focus();
	vi.setSystemTime(new Date(2026, 9, 19, 12));
	document.dispatchEvent(new Event("visibilitychange"));
	await expect.element(page.getByText("1 selected", { exact: true })).toBeVisible();
	await expect.element(row).toHaveFocus();
	await expect
		.element(page.getByText("Selection cleared", { exact: false }))
		.not.toBeInTheDocument();
});

test.each(["create", "edit"] as const)(
	"%s explains a saved hidden Show from without revealing it",
	async (operation) => {
		const deferred = {
			...todo,
			raw: "Plan release +Work t:9999-12-31",
			metadata: { t: "9999-12-31" },
			edit: { description: "Plan release", metadata: ["t:9999-12-31"] },
		};
		render(Harness, {
			desktop: adapter({
				createTodo: async () => ({ status: "applied", confirmed: confirmedTodo([deferred]) }),
				editTodo: async () => ({ status: "applied", confirmed: confirmedTodo([deferred]) }),
			}),
		});
		if (operation === "edit") {
			await page.getByRole("button", { name: "Actions for Plan release", exact: true }).click();
			await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
		} else {
			await page.getByRole("button", { name: "Add Todo item", exact: true }).click();
			await page.getByPlaceholder("What needs doing?").fill("Plan release");
		}
		await page.getByPlaceholder("Add key:value").fill("t:9999-12-31");
		await userEvent.keyboard("{Enter}");
		await page
			.getByRole("button", {
				name: operation === "edit" ? "Save changes" : "Add Todo item",
				exact: true,
			})
			.last()
			.click();
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
		await expect
			.element(
				page.getByText("Hidden until Show from 9999-12-31. Use Show deferred to see it.", {
					exact: true,
				})
			)
			.toBeVisible();
		await expect
			.element(page.getByRole("button", { name: "Show deferred", exact: true }).first())
			.toHaveAttribute("aria-pressed", "false");
		await expect
			.element(page.getByRole("button", { name: "Actions for Plan release", exact: true }))
			.not.toBeInTheDocument();
	}
);
