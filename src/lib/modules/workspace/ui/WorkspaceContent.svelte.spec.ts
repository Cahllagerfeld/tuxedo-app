import { page, userEvent } from "vitest/browser";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { toast } from "svelte-sonner";
import { prefersReducedMotion } from "svelte/motion";
import type {
	ConfirmedSession,
	DesktopAPI,
	TodoFile,
	TodoFileChange,
} from "$lib/shared/desktop/contract";
import { localToday } from "$lib/modules/todo/domain/todo-due";
import Harness from "./WorkspaceContentHarness.svelte";
import "../../../../routes/layout.css";
afterEach(async () => {
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
	return {
		readSavedViews: async () => ({ status: "applied", views: [] }),
		saveView: async () => ({ status: "rejected", message: "unused" }),
		deleteView: async () => ({ status: "rejected", message: "unused" }),
		readSession: async () => initial,
		restoreSession: async () => initial,
		writeClipboardText: async () => null,
		selectTodoFile: async () => null,
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
		createTodo: async () => ({ status: "rejected", message: "unused" }),
		...overrides,
	};
}
function confirmedTodo(items: TodoFile["items"]) {
	return {
		scope,
		revision: 2,
		workspaceId,
		todo_file: { path: "/tmp/work.todo", items, skipped: [] },
	};
}
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
			restoreSession: async () =>
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
			restoreSession: async () => ({
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
test("details preserve the raw line, show all attributes, resize, and follow keyboard navigation", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	await page.viewport(1400, 900);
	const rich = {
		...todo,
		raw: "Plan\t release  +Work +Launch @desk @home due:broken custom:first custom:last",
		projects: ["Work", "Launch"],
		contexts: ["desk", "home"],
		metadata: { due: "broken", custom: "last" },
		edit: { description: "Plan release", metadata: ["due:broken", "custom:first", "custom:last"] },
	};
	const neighbor = {
		...todo,
		line_number: 2,
		raw: "Neighbor",
		description: "Neighbor",
		projects: [],
	};
	const clipboard = vi.fn().mockResolvedValue(null);
	const previousDesktop = window.desktop;
	window.desktop = {
		...adapter({}),
		writeClipboardText: clipboard,
		onTodoFileChanged: () => () => {},
	};
	try {
		render(Harness, {
			desktop: adapter({
				restoreSession: async () =>
					({
						...initial,
						session: {
							...initial.session,
							todo_file: { path: "/tmp/work.todo", items: [rich, neighbor], skipped: [] },
						},
					}) as ConfirmedSession,
			}),
		});
		const row = page.getByRole("button", { name: "Navigate Plan release", exact: true });
		await row.click();
		const panel = page.getByRole("complementary", { name: "Todo item details" });
		await expect.element(panel).toBeVisible();
		await expect.element(panel.getByText("+Launch", { exact: true }).first()).toBeVisible();
		await expect.element(panel.getByText("@home", { exact: true }).first()).toBeVisible();
		await expect.element(panel.getByText("Not a valid date", { exact: true })).toBeVisible();
		expect(panel.element().querySelector("code")?.textContent).toBe(rich.raw);
		await panel.getByRole("button", { name: "Copy raw line", exact: true }).click();
		expect(clipboard).toHaveBeenCalledWith({ text: rich.raw });
		await expect.element(panel.getByRole("status")).toHaveTextContent("Raw line copied");
		clipboard.mockRejectedValueOnce(Error("Clipboard unavailable"));
		const errorToast = vi.spyOn(toast, "error");
		try {
			await panel.getByRole("button", { name: "Copy raw line", exact: true }).click();
			await expect.poll(() => errorToast.mock.calls).toEqual([["Could not copy raw line"]]);
			await expect.element(panel.getByRole("status")).not.toBeInTheDocument();
		} finally {
			errorToast.mockRestore();
		}
		const divider = page.getByRole("separator", { name: "Resize Todo item details" });
		const before = divider.element().getAttribute("aria-valuenow");
		(divider.element() as HTMLElement).focus();
		await userEvent.keyboard("{ArrowLeft}");
		await expect.poll(() => divider.element().getAttribute("aria-valuenow")).not.toBe(before);
		(row.element() as HTMLElement).focus();
		await userEvent.keyboard("{ArrowDown}");
		await expect
			.element(panel.getByRole("heading", { name: "Neighbor", exact: true }))
			.toBeVisible();
		await userEvent.keyboard("{Escape}");
		await expect.element(panel).not.toBeInTheDocument();
		await expect
			.element(page.getByRole("button", { name: "Navigate Neighbor", exact: true }))
			.toHaveFocus();
	} finally {
		window.desktop = previousDesktop;
	}
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
			restoreSession: async () =>
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
	notify({ scope, revision: 1, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.element(page.getByText("Replacement", { exact: true })).toBeVisible();
	await expect.element(panel).not.toBeInTheDocument();
	notify({ scope, revision: 2, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.element(page.getByText("Plan release", { exact: true })).toBeVisible();
	await expect.element(panel).not.toBeInTheDocument();
});

test("narrow details use a Sheet, allow editing, and restore the row after Escape", async () => {
	await page.viewport(700, 800);
	render(Harness, { desktop: adapter() });
	const row = page.getByRole("button", { name: "Navigate Plan release", exact: true });
	await row.click();
	const sheet = page.getByRole("dialog", { name: "Todo item details", exact: true });
	await expect.element(sheet).toBeVisible();
	await sheet.getByRole("button", { name: "Edit", exact: true }).click();
	await expect
		.element(page.getByRole("dialog", { name: "Edit Todo item", exact: true }))
		.toBeVisible();
	await userEvent.keyboard("{Escape}");
	await expect.element(sheet).toBeVisible();
	await expect.element(sheet.getByRole("button", { name: "Edit", exact: true })).toHaveFocus();
	await page.viewport(1400, 800);
	const panel = page.getByRole("complementary", { name: "Todo item details" });
	await expect.element(panel).toBeVisible();
	await expect
		.element(panel.getByRole("button", { name: "Close details", exact: true }))
		.toHaveFocus();
	await userEvent.keyboard("{Escape}");
	await expect.element(row).toHaveFocus();
	await page.viewport(700, 800);
	await userEvent.keyboard("{Enter}");
	await expect.element(sheet).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await expect.element(sheet).not.toBeInTheDocument();
	await expect.element(row).toHaveFocus();
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
		desktop: adapter({ restoreSession: async () => (loads++ ? refreshed : initial) }),
		observation: {
			onTodoFileChanged(listener) {
				notify = listener;
				return () => {};
			},
		},
	});
	await expect.element(page.getByText("Plan release", { exact: true })).toBeVisible();
	notify({ scope, revision: 1, workspaceId, todoPath: "/tmp/work.todo" });
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
			restoreSession: async () => (loads++ ? refreshed : initial),
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
	await expect.poll(() => loads).toBe(2);
	await expect.element(page.getByText("Todo file reloaded")).toBeVisible();
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
	await expect.element(page.getByText("Todo file reloaded")).toBeVisible();
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

test("confirmed final deletion clears all App summary facts", async () => {
	render(Harness, {
		desktop: adapter({
			deleteTodo: async () => ({ status: "applied", confirmed: confirmedTodo([]) }),
		}),
	});
	await page.getByRole("button", { name: "Actions for Plan release" }).click();
	await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
	await expect.element(page.getByText("Plan release", { exact: true })).not.toBeInTheDocument();
	await expect.element(page.getByLabelText("Summary counts")).toHaveTextContent("0/0");
	await expect.element(page.getByLabelText("Filter projects")).toHaveTextContent("");
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
	// Allow both validation continuations and any busy rejection to settle.
	await new Promise((resolve) => setTimeout(resolve, 0));
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
	description
		.element()
		.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	await new Promise((resolve) => setTimeout(resolve, 150));
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
			restoreSession: async () => loaded,
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
	await page.getByRole("button", { name: "Creation date (optional)" }).click();
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
	await page.getByRole("button", { name: "Creation date (optional)" }).click();
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
				page.getByText(status === "conflict" ? "Todo file reloaded" : "Permission denied").last()
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
			restoreSession: async () => snapshot,
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
			restoreSession: async () => ({
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
	notify({ scope, revision: 1, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.element(page.getByLabelText("No matching Todo items")).toBeVisible();
	await expect.element(search).toHaveValue("plan");
	await search.fill("different");
	await expect.element(page.getByText("Different content", { exact: true })).toBeVisible();
});

test("row menu opens a prefilled edit form and saves through the scoped session controller", async () => {
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
test("editing a completed token-only item prefills empty Description and retains repeated metadata", async () => {
	if (initial.session.status !== "ready") throw Error("setup");
	const completed = {
		...todo,
		raw: "x +Work custom:first custom:last pri:Z",
		edit: { description: "", metadata: ["custom:first", "custom:last", "pri:Z"] },
		description: "+Work custom:first custom:last pri:Z",
		completed: true,
		metadata: { custom: "last", pri: "Z" },
	};
	const snapshot = {
		...initial,
		session: {
			...initial.session,
			todo_file: { ...initial.session.todo_file, items: [completed] },
		},
	};
	let request: Parameters<DesktopAPI["editTodo"]>[0] | undefined;
	render(Harness, {
		desktop: adapter({
			restoreSession: async () => snapshot,
			editTodo: async (input) => {
				request = input;
				return { status: "rejected", message: "Read only" };
			},
		}),
	});
	await page
		.getByRole("button", { name: `Actions for ${completed.description}`, exact: true })
		.click();
	await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
	await expect.element(page.getByRole("textbox", { name: /Description/ })).toHaveValue("");
	await expect
		.element(page.getByRole("button", { name: "Clear Creation date", exact: true }))
		.toBeVisible();
	await expect
		.element(page.getByRole("button", { name: "Clear Completion date", exact: true }))
		.toBeVisible();
	await page.getByRole("textbox", { name: /Description/ }).fill("Updated");
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect.element(page.getByText("Read only", { exact: true })).toBeVisible();
	expect(request).toMatchObject({
		description: "Updated",
		completed: true,
		completionDate: null,
		creationDate: null,
		metadata: ["custom:first", "custom:last", "pri:Z"],
	});
	await expect.element(page.getByRole("textbox", { name: /Description/ })).toHaveValue("Updated");
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("row navigation focus opens the existing editor and returns after Escape", async () => {
	render(Harness, { desktop: adapter() });
	const row = page.getByRole("button", { name: "Navigate Plan release", exact: true });
	await expect.element(row).toBeVisible();
	(row.element() as HTMLElement).focus();
	await userEvent.keyboard("e");
	await expect.element(page.getByRole("dialog", { name: "Edit Todo item" })).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await expect.element(row).toHaveFocus();
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

test.each(["next", "previous", "empty"])(
	"completion hiding a focused row recovers to %s",
	async (direction) => {
		if (initial.session.status !== "ready") throw Error("Expected Ready");
		const neighbor = { ...todo, line_number: 2, raw: "Neighbor", description: "Neighbor" };
		const items =
			direction === "empty" ? [todo] : direction === "next" ? [todo, neighbor] : [neighbor, todo];
		await page.viewport(1200, 800);
		render(Harness, {
			shell: true,
			desktop: adapter({
				restoreSession: async () =>
					({
						...initial,
						session: {
							...initial.session,
							todo_file: { path: "/tmp/work.todo", items, skipped: [] },
						},
					}) as ConfirmedSession,
				setTodoCompletion: async () => ({
					status: "applied",
					confirmed: confirmedTodo(
						items.map((item) =>
							item === todo ? { ...item, completed: true, raw: "x Plan release +Work" } : item
						)
					),
				}),
			}),
		});
		await page.getByRole("button", { name: /^Open / }).click();
		const row = page.getByRole("button", { name: "Navigate Plan release", exact: true });
		await expect.element(row).toBeVisible();
		(row.element() as HTMLElement).focus();
		await userEvent.keyboard("{Space}");
		await expect.element(row).not.toBeInTheDocument();
		if (direction === "empty") {
			expect(document.activeElement).toBe(
				document.querySelector(
					'[aria-label="Todo item results"] [data-slot="scroll-area-viewport"]'
				)
			);
		} else
			await expect
				.element(page.getByRole("button", { name: "Navigate Neighbor", exact: true }))
				.toHaveFocus();
	}
);

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
			restoreSession: async () =>
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
	notify({ scope, revision: 1, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.poll(() => loads).toBe(2);
	await expect.element(row).toHaveFocus();
	notify({ scope, revision: 2, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.element(page.getByText("Different content", { exact: true })).toBeVisible();
	await expect.element(page.getByRole("list", { name: "Todo items" })).toHaveFocus();
});

test("deleting through Actions focuses the next physical-line neighbor", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const neighbor = { ...todo, line_number: 2, raw: "Neighbor", description: "Neighbor" };
	render(Harness, {
		desktop: adapter({
			restoreSession: async () =>
				({
					...initial,
					session: {
						...initial.session,
						todo_file: { path: "/tmp/work.todo", items: [todo, neighbor], skipped: [] },
					},
				}) as ConfirmedSession,
			deleteTodo: async () => ({
				status: "applied",
				confirmed: confirmedTodo([{ ...neighbor, line_number: 1 }]),
			}),
		}),
	});
	await page.getByRole("button", { name: "Actions for Plan release", exact: true }).click();
	await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
	await expect
		.element(page.getByRole("button", { name: "Navigate Neighbor", exact: true }))
		.toHaveFocus();
});

test.each([
	["MacIntel", "Meta", "Control", "⌘"],
	["Win32", "Control", "Meta", "Ctrl"],
	["Linux x86_64", "Control", "Meta", "Ctrl"],
])("%s uses its platform modifier and hint", async (platform, mod, other, hint) => {
	const platformMock = vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
	const agentMock = vi.spyOn(navigator, "userAgent", "get").mockReturnValue(platform);
	try {
		await page.viewport(1200, 800);
		const view = await render(Harness, { desktop: adapter(), shell: true });
		await expect.element(page.getByText("Plan release", { exact: true })).toBeVisible();
		await userEvent.keyboard(`{${other}>}n{/${other}}`);
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
		await userEvent.keyboard(`{${mod}>}n{/${mod}}`);
		await expect.element(page.getByRole("dialog", { name: "New Todo item" })).toBeVisible();
		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
		await page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click();
		await expect.element(page.getByRole("dialog")).toMatchTextContent(hint);
		await view.unmount();
	} finally {
		platformMock.mockRestore();
		agentMock.mockRestore();
	}
});

test("shortcuts clean up on remount and modifier actions remain usable while typing", async () => {
	await page.viewport(1200, 800);
	const view = await render(Harness, { desktop: adapter(), shell: true });
	await expect.element(page.getByText("Plan release", { exact: true })).toBeVisible();
	await view.unmount();
	render(Harness, { desktop: adapter(), shell: true });
	await expect.element(page.getByText("Plan release", { exact: true })).toBeVisible();
	const input = page.getByRole("searchbox", { name: "Find a filter" });
	await input.fill("Work");
	await userEvent.keyboard("{Space}{ArrowDown}{Enter}");
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	const mod = /Mac/i.test(navigator.platform) ? "Meta" : "Control";
	await userEvent.keyboard(`{${mod}>}b{/${mod}}`);
	await expect
		.poll(() => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state"))
		.toBe("collapsed");
	await userEvent.keyboard(`{${mod}>}b{/${mod}}`);
	await expect
		.poll(() => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state"))
		.toBe("expanded");
	await userEvent.keyboard(`{${mod}>}k{/${mod}}`);
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

test("loading suspends mutations, help remains available, and held sidebar keys fire once", async () => {
	await page.viewport(1200, 800);
	let ready!: (session: ConfirmedSession) => void;
	render(Harness, {
		desktop: adapter({
			restoreSession: () =>
				new Promise((resolve) => {
					ready = resolve;
				}),
		}),
		shell: true,
	});
	await expect.element(page.getByRole("list", { name: "Todo items" })).not.toBeInTheDocument();
	const mod = /Mac/i.test(navigator.platform) ? "Meta" : "Control";
	await userEvent.keyboard(`{${mod}>}n{/${mod}}`);
	await userEvent.keyboard(`{${mod}>}p{/${mod}}`);
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
	await userEvent.keyboard(`{${mod}>}/{/${mod}}`);
	await expect.element(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	ready(initial);
	await expect.element(page.getByText("Plan release", { exact: true })).toBeVisible();
	const options = {
		key: "b",
		code: "KeyB",
		bubbles: true,
		metaKey: mod === "Meta",
		ctrlKey: mod === "Control",
	};
	document.dispatchEvent(new KeyboardEvent("keydown", options));
	document.dispatchEvent(new KeyboardEvent("keydown", { ...options, repeat: true }));
	document.dispatchEvent(new KeyboardEvent("keyup", options));
	await expect
		.poll(() => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state"))
		.toBe("collapsed");
});

test("nested editor suggestions consume Escape before the editor and suppress background keys", async () => {
	await page.viewport(1200, 800);
	render(Harness, { desktop: adapter(), shell: true });
	await expect.element(page.getByText("Plan release", { exact: true })).toBeVisible();
	const mod = /Mac/i.test(navigator.platform) ? "Meta" : "Control";
	await userEvent.keyboard(`{${mod}>}n{/${mod}}`);
	const dialog = page.getByRole("dialog", { name: "New Todo item" });
	await expect.element(dialog).toBeVisible();
	await dialog.getByPlaceholder("Choose or create a Project").click();
	await expect.element(page.getByRole("listbox")).toBeVisible();
	await userEvent.keyboard(`{${mod}>}b{/${mod}}`);
	await userEvent.keyboard("{Escape}");
	await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();
	await expect.element(dialog).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await expect.element(dialog).not.toBeInTheDocument();
});

test("editing a row out of a Project filter returns focus to its visible neighbor", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	await page.viewport(1200, 800);
	const neighbor = { ...todo, line_number: 2, raw: "Neighbor +Work", description: "Neighbor" };
	render(Harness, {
		shell: true,
		desktop: adapter({
			restoreSession: async () =>
				({
					...initial,
					session: {
						...initial.session,
						todo_file: { path: "/tmp/work.todo", items: [todo, neighbor], skipped: [] },
					},
				}) as ConfirmedSession,
			editTodo: async () => ({
				status: "applied",
				confirmed: confirmedTodo([
					{ ...todo, raw: "Plan release +Home", projects: ["Home"] },
					neighbor,
				]),
			}),
		}),
	});
	await page.getByRole("button", { name: "+Work", exact: true }).click();
	const row = page.getByRole("button", { name: "Navigate Plan release", exact: true });
	await expect.element(row).toBeVisible();
	(row.element() as HTMLElement).focus();
	await userEvent.keyboard("e");
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect
		.element(page.getByRole("button", { name: "Navigate Neighbor", exact: true }))
		.toHaveFocus();
});

test.each(["applied", "conflict", "rejected"] as const)(
	"row completion %s uses one admitted mutation and existing feedback",
	async (status) => {
		await page.viewport(1200, 800);
		let calls = 0;
		let finish!: (result: Awaited<ReturnType<DesktopAPI["setTodoCompletion"]>>) => void;
		render(Harness, {
			shell: true,
			desktop: adapter({
				setTodoCompletion: () => {
					calls++;
					return new Promise((resolve) => {
						finish = resolve;
					});
				},
			}),
		});
		const row = page.getByRole("button", { name: "Navigate Plan release", exact: true });
		await expect.element(row).toBeVisible();
		(row.element() as HTMLElement).focus();
		await userEvent.keyboard("{Space}{Space}{Enter}");
		const mod = /Mac/i.test(navigator.platform) ? "Meta" : "Control";
		await userEvent.keyboard(`{${mod}>}p{/${mod}}`);
		await userEvent.keyboard(`{${mod}>}n{/${mod}}`);
		await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
		expect(calls).toBe(1);
		const confirmed = confirmedTodo([
			{
				...todo,
				completed: status === "applied",
				raw: status === "applied" ? "x Plan release +Work" : "Changed",
				description: status === "applied" ? todo.description : "Changed",
			},
		]);
		if (status === "rejected") finish({ status, message: "Permission denied" });
		else if (status === "conflict") finish({ status, confirmed, message: "Changed externally" });
		else finish({ status, confirmed });
		if (status === "conflict") {
			await expect.element(page.getByText("Todo file reloaded", { exact: true })).toBeVisible();
			await expect.element(page.getByRole("list", { name: "Todo items" })).toHaveFocus();
		} else {
			await expect.element(row).toHaveFocus();
			if (status === "rejected")
				await expect.element(page.getByText("Permission denied", { exact: true })).toBeVisible();
			else
				await expect
					.element(
						page.getByRole("checkbox", { name: "Mark Plan release incomplete", exact: true })
					)
					.toBeChecked();
		}
	}
);

test("Tab reenters row navigation after leaving and scrolling to another virtualization window", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const items = Array.from({ length: 1000 }, (_, index) => ({
		...todo,
		line_number: index + 1,
		raw: `Item ${index + 1}`,
		description: `Item ${index + 1}`,
		projects: [],
	}));
	let loads = 0;
	let notify!: (change: TodoFileChange) => void;
	render(Harness, {
		observation: {
			onTodoFileChanged(listener) {
				notify = listener;
				return () => {};
			},
		},
		desktop: adapter({
			restoreSession: async () =>
				({
					...initial,
					revision: ++loads,
					session: {
						...initial.session,
						todo_file: { path: "/tmp/work.todo", items, skipped: [] },
					},
				}) as ConfirmedSession,
		}),
	});
	const first = page.getByRole("button", { name: "Navigate Item 1", exact: true });
	await expect.element(first).toBeVisible();
	(first.element() as HTMLElement).focus();
	(
		page.getByRole("button", { name: "Add Todo item", exact: true }).element() as HTMLElement
	).focus();
	notify({ scope, revision: 1, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.poll(() => loads).toBe(2);
	const viewport = document.querySelector<HTMLElement>(
		'[aria-label="Todo item results"] [data-slot="scroll-area-viewport"]'
	)!;
	viewport.scrollTop = viewport.scrollHeight;
	await expect.element(page.getByText("Item 1000", { exact: true })).toBeVisible();
	await expect.element(first).not.toBeInTheDocument();
	await userEvent.keyboard("{Tab}");
	await expect.element(page.getByRole("list", { name: "Todo items" })).toHaveFocus();
	await userEvent.keyboard("{ArrowDown}");
	await expect.element(first).toHaveFocus();
});

test.each([false, true])(
	"detail motion respects reduced motion (%s) without animating item navigation",
	async (reduced) => {
		await page.viewport(1400, 900);
		const preference = vi.spyOn(prefersReducedMotion, "current", "get").mockReturnValue(reduced);
		const animations = vi.spyOn(HTMLElement.prototype, "animate");
		try {
			const neighbor = { ...todo, line_number: 2, raw: "Neighbor", description: "Neighbor" };
			render(Harness, {
				desktop: adapter({
					restoreSession: async () =>
						({
							...initial,
							session: {
								...initial.session,
								status: "ready",
								todo_file: { path: "/tmp/work.todo", items: [todo, neighbor], skipped: [] },
							},
						}) as ConfirmedSession,
				}),
			});
			await page.getByRole("button", { name: "Navigate Plan release", exact: true }).click();
			const panel = page.getByRole("complementary", { name: "Todo item details" });
			await expect.element(panel).toBeVisible();
			const element = panel.element();
			const pane = element.parentElement;
			const panelAnimations = () =>
				animations.mock.calls.filter((_, index) => animations.mock.contexts[index] === pane);
			if (reduced) expect(panelAnimations()).toHaveLength(0);
			else {
				await expect.poll(() => panelAnimations().length).toBeGreaterThan(0);
				expect(panelAnimations().at(-1)?.[1]).toMatchObject({ duration: 200 });
				expect(panelAnimations().at(-1)?.[0]).toEqual(
					expect.arrayContaining([expect.objectContaining({ flexGrow: "0" })])
				);
			}
			const before = panelAnimations().length;
			await page.getByRole("button", { name: "Navigate Neighbor", exact: true }).click();
			await expect
				.element(panel.getByRole("heading", { name: "Neighbor", exact: true }))
				.toBeVisible();
			expect(panel.element()).toBe(element);
			expect(panelAnimations()).toHaveLength(before);
			await panel.getByRole("button", { name: "Close details", exact: true }).click();
			await expect.element(panel).not.toBeInTheDocument();
			if (reduced) expect(panelAnimations()).toHaveLength(0);
			else expect(panelAnimations().length).toBeGreaterThan(before);
		} finally {
			animations.mockRestore();
			preference.mockRestore();
		}
	}
);

test("save, apply, and delete a Workspace-specific view through the desktop adapter", async () => {
	const views: import("$lib/shared/desktop/contract").SavedView[] = [];
	render(Harness, {
		desktop: adapter({
			readSavedViews: async () => ({ status: "applied", views }),
			saveView: async (request) => {
				views.push({
					id: scope,
					workspace_id: request.workspaceId,
					name: request.name,
					filters: request.filters,
				});
				return { status: "applied", views: [...views] };
			},
			deleteView: async (request) => {
				expect(request).toEqual({ workspaceId, viewId: scope });
				return { status: "applied", views: [] };
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

test("a failed saved-view read warns while the confirmed Todo file remains usable", async () => {
	render(Harness, {
		desktop: adapter({
			readSavedViews: async () => ({
				status: "rejected",
				message: "Saved views file is invalid and has been preserved.",
			}),
		}),
	});
	await expect
		.element(page.getByRole("button", { name: "Saved views", exact: true }))
		.toBeEnabled();
	await page.getByRole("button", { name: "Saved views", exact: true }).click();
	await expect
		.element(page.getByText("Saved views file is invalid and has been preserved."))
		.toHaveTextContent("Saved views file is invalid and has been preserved.");
	await expect
		.element(page.getByRole("button", { name: "Save current view", exact: true }))
		.toBeDisabled();
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("1 matching item");
});

test("saving a view by shortcut opens the naming dialog and respects dialog scope", async () => {
	render(Harness, { desktop: adapter(), shell: true });
	const mod = navigator.platform.includes("Mac") ? "Meta" : "Control";
	await expect
		.element(page.getByRole("button", { name: "Saved views", exact: true }))
		.toBeEnabled();
	await page.getByRole("button", { name: "Toggle Todo-item search" }).click();
	await page.getByRole("searchbox", { name: "Search Todo items" }).fill("release");
	await userEvent.keyboard(`{${mod}>}{Shift>}S{/Shift}{/${mod}}`);
	await expect.element(page.getByRole("dialog", { name: "Save current view" })).toBeVisible();
	await page.getByRole("textbox", { name: "View name" }).fill("Release view");
	await userEvent.keyboard(`{${mod}>}{Shift>}S{/Shift}{/${mod}}`);
	await expect
		.element(page.getByRole("textbox", { name: "View name" }))
		.toHaveValue("Release view");
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
	await expect
		.element(page.getByRole("dialog").getByText("Save current view", { exact: true }))
		.toBeVisible();
	await userEvent.keyboard(`{${mod}>}{Shift>}S{/Shift}{/${mod}}`);
	await expect
		.element(page.getByRole("dialog", { name: "Save current view" }))
		.not.toBeInTheDocument();
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

test("a future Show from successor stays hidden until Show deferred", async () => {
	const source: TodoFile["items"][number] = {
		...todo,
		raw: "Mow lawn rec:1m",
		description: "Mow lawn",
		projects: [],
		metadata: { rec: "1m" },
		edit: { description: "Mow lawn", metadata: ["rec:1m"] },
	};
	const completed: TodoFile["items"][number] = {
		...source,
		completed: true,
		completion_date: "2026-10-16",
		raw: "x 2026-10-16 Mow lawn rec:1m tuxedo-generated:1",
		metadata: { rec: "1m", "tuxedo-generated": "1" },
	};
	const successor: TodoFile["items"][number] = {
		...source,
		line_number: 2,
		raw: "2026-10-16 Next mow rec:1m due:2026-11-16 t:2099-01-01",
		description: "Next mow",
		creation_date: "2026-10-16",
		metadata: { rec: "1m", due: "2026-11-16", t: "2099-01-01" },
		edit: { description: "Next mow", metadata: ["rec:1m", "due:2026-11-16", "t:2099-01-01"] },
	};
	const notice = "Next occurrence due 2026-11-16. Show from 2099-01-01.";
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const ready = initial.session;
	let current: ConfirmedSession = {
		...initial,
		session: {
			...ready,
			todo_file: { path: "/tmp/work.todo", items: [source], skipped: [] },
		},
	};
	render(Harness, {
		desktop: adapter({
			restoreSession: async () => current,
			setTodoCompletion: async () => {
				if (current.session.status !== "ready") throw Error("not ready");
				current = {
					...current,
					revision: 2,
					session: {
						...current.session,
						todo_file: { path: "/tmp/work.todo", items: [completed, successor], skipped: [] },
					},
				};
				return { status: "applied", confirmed: confirmedTodo([completed, successor]), notice };
			},
			setWorkspaceShowDeferred: async ({ showDeferred }) => {
				if (current.session.status !== "ready") throw Error("not ready");
				current = {
					...current,
					revision: current.revision + 1,
					session: {
						...current.session,
						catalogue: {
							...current.session.catalogue,
							workspaces: current.session.catalogue.workspaces.map((workspace) =>
								workspace.id === workspaceId
									? { ...workspace, show_deferred: showDeferred }
									: workspace
							),
						},
					},
				};
				return { status: "applied", confirmed: current };
			},
		}),
	});
	await page.getByRole("checkbox", { name: "Mark Mow lawn complete", exact: true }).click();
	const toggle = page.getByRole("button", { name: "Show deferred", exact: true });
	await expect.element(page.getByText(notice, { exact: true })).toBeVisible();
	await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
	await expect.element(toggle).toHaveTextContent("1");
	await expect.element(page.getByText("Next mow", { exact: true })).not.toBeInTheDocument();
	await expect
		.element(page.getByLabelText("Filtered result count"))
		.toHaveTextContent("1 matching item");
	await toggle.click();
	await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
	await expect.element(page.getByText("Next mow", { exact: true })).toBeVisible();
	await expect
		.element(page.getByTitle("Show from 2099-01-01 · Deferred", { exact: true }))
		.toBeVisible();
});

test("a successor is shown on its Show from date", async () => {
	const today = localToday();
	const source: TodoFile["items"][number] = {
		...todo,
		raw: "Mow lawn rec:1d",
		description: "Mow lawn",
		projects: [],
		metadata: { rec: "1d" },
		edit: { description: "Mow lawn", metadata: ["rec:1d"] },
	};
	const successor: TodoFile["items"][number] = {
		...source,
		line_number: 2,
		raw: `Next mow due:${today} t:${today}`,
		description: "Next mow",
		metadata: { rec: "1d", due: today, t: today },
		edit: { description: "Next mow", metadata: ["rec:1d", `due:${today}`, `t:${today}`] },
	};
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const ready = initial.session;
	render(Harness, {
		desktop: adapter({
			restoreSession: async () => ({
				...initial,
				session: {
					...ready,
					todo_file: { path: "/tmp/work.todo", items: [source], skipped: [] },
				},
			}),
			setTodoCompletion: async () => ({
				status: "applied",
				confirmed: confirmedTodo([{ ...source, completed: true, raw: "x Mow lawn" }, successor]),
				notice: `Next occurrence due ${today}.`,
			}),
		}),
	});
	await page.getByRole("checkbox", { name: "Mark Mow lawn complete", exact: true }).click();
	await expect.element(page.getByText("Next mow", { exact: true })).toBeVisible();
	await expect
		.element(page.getByRole("button", { name: "Show deferred", exact: true }))
		.toHaveTextContent("");
	await expect
		.element(page.getByText(`Next occurrence due ${today}.`, { exact: true }))
		.toBeVisible();
});
test.each(["mixed", "completed remaining", "completed empty"])(
	"bulk uncompletion handles %s selection, counts and usable focus",
	async (view) => {
		await page.viewport(1400, 900);
		if (initial.session.status !== "ready") throw Error("Expected Ready");
		const ready = initial.session;
		const completed = {
			...todo,
			completed: true,
			raw: "x 2026-10-16 Plan release +Work",
			completion_date: "2026-10-16",
		};
		const other = { ...todo, line_number: 2, description: "Other", raw: "Other" };
		const selectedOther =
			view === "completed empty" ? { ...other, completed: true, raw: "x Other" } : other;
		const remaining = {
			...completed,
			line_number: 3,
			description: "Remaining",
			raw: "x 2026-10-16 Remaining",
		};
		const items = [
			completed,
			selectedOther,
			...(view === "completed remaining" ? [remaining] : []),
		];
		const bulk = vi.fn<DesktopAPI["bulkSetTodoCompletion"]>(async () => ({
			status: "applied",
			confirmed: confirmedTodo([
				todo,
				other,
				...(view === "completed remaining" ? [remaining] : []),
			]),
		}));
		render(Harness, {
			shell: true,
			desktop: adapter({
				restoreSession: async () => ({
					...initial,
					session: {
						...ready,
						todo_file: { path: "/tmp/work.todo", items, skipped: [] },
					},
				}),
				bulkSetTodoCompletion: bulk,
			}),
		});
		if (view !== "mixed")
			await page
				.getByRole("button", {
					name: /^Completed/,
					exact: true,
				})
				.click();
		await page.getByRole("button", { name: "Select items", exact: true }).click();
		const incomplete = page.getByRole("button", { name: "Mark incomplete", exact: true });
		await expect.element(incomplete).toBeDisabled();
		if (view === "mixed") {
			await page.getByRole("checkbox", { name: "Select Other", exact: true }).click();
			await expect.element(incomplete).toBeDisabled();
			await expect
				.element(page.getByRole("button", { name: "Complete", exact: true }))
				.toBeEnabled();
		}
		await page.getByRole("checkbox", { name: "Select Plan release", exact: true }).click();
		if (view === "completed empty")
			await page.getByRole("checkbox", { name: "Select Other", exact: true }).click();
		await expect.element(incomplete).toBeEnabled();
		if (view !== "mixed")
			await expect
				.element(page.getByRole("button", { name: "Complete", exact: true }))
				.toBeDisabled();
		await incomplete.click();
		expect(bulk).toHaveBeenCalledExactlyOnceWith({
			scope,
			revision: 1,
			workspaceId,
			completed: false,
			targets: (view === "completed remaining" ? [completed] : [completed, selectedOther]).map(
				(item) => ({
					lineNumber: item.line_number,
					expectedRaw: item.raw,
				})
			),
		});
		await expect
			.element(
				page.getByText(
					view === "completed empty"
						? "Marked 2 Todo items incomplete"
						: "Marked 1 Todo item incomplete",
					{ exact: true }
				)
			)
			.toBeVisible();
		await expect.element(page.getByText("0 selected", { exact: true })).toBeVisible();
		await expect
			.element(
				page.getByRole("button", {
					name:
						view === "completed empty"
							? "Exit selection mode"
							: view === "completed remaining"
								? "Navigate Remaining"
								: "Navigate Plan release",
					exact: true,
				})
			)
			.toHaveFocus();
	}
);

test.each([
	{ status: "conflict", moveFocus: false },
	{ status: "applied", moveFocus: true },
	{ status: "conflict", moveFocus: true },
] as const)(
	"bulk completion focus after $status with deliberate viewport focus=$moveFocus",
	async ({ status, moveFocus }) => {
		await page.viewport(1400, 900);
		if (initial.session.status !== "ready") throw Error("Expected Ready");
		const ready = initial.session;
		const completed = { ...todo, completed: true, raw: "x Plan release +Work" };
		let finish!: (result: Awaited<ReturnType<DesktopAPI["bulkSetTodoCompletion"]>>) => void;
		render(Harness, {
			shell: true,
			desktop: adapter({
				restoreSession: async () => ({
					...initial,
					session: {
						...ready,
						todo_file: { path: "/tmp/work.todo", items: [completed], skipped: [] },
					},
				}),
				bulkSetTodoCompletion: () =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			}),
		});
		await page.getByRole("button", { name: /^Completed/ }).click();
		await page.getByRole("button", { name: "Select items", exact: true }).click();
		await page.getByRole("button", { name: "Select all", exact: true }).click();
		const action = page.getByRole("button", { name: "Mark incomplete", exact: true });
		await action.click();
		await expect.element(action).toBeDisabled();
		const viewport = document.querySelector<HTMLElement>(
			'[aria-label="Todo item results"] [data-slot="scroll-area-viewport"]'
		)!;
		if (moveFocus) {
			viewport.focus();
			expect(document.activeElement).toBe(viewport);
		}
		finish(
			status === "applied"
				? { status, confirmed: confirmedTodo([todo]) }
				: { status, message: "Changed externally", confirmed: confirmedTodo([todo]) }
		);
		await expect.element(page.getByText("0 selected", { exact: true })).toBeVisible();
		await expect
			.element(page.getByRole("checkbox", { name: "Select Plan release", exact: true }))
			.not.toBeInTheDocument();
		if (moveFocus) await expect.poll(() => document.activeElement).toBe(viewport);
		else
			await expect
				.element(page.getByRole("button", { name: "Exit selection mode", exact: true }))
				.toHaveFocus();
	}
);

test.each(["rejected", "conflict"] as const)(
	"pending bulk uncompletion locks actions and handles %s",
	async (status) => {
		if (initial.session.status !== "ready") throw Error("Expected Ready");
		const ready = initial.session;
		const completed = { ...todo, completed: true, raw: "x Plan release +Work" };
		let finish!: (result: Awaited<ReturnType<DesktopAPI["bulkSetTodoCompletion"]>>) => void;
		const bulk = vi.fn<DesktopAPI["bulkSetTodoCompletion"]>(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		render(Harness, {
			shell: true,
			desktop: adapter({
				restoreSession: async () => ({
					...initial,
					session: {
						...ready,
						todo_file: { path: "/tmp/work.todo", items: [completed], skipped: [] },
					},
				}),
				bulkSetTodoCompletion: bulk,
			}),
		});
		await page.getByRole("button", { name: "Select items", exact: true }).click();
		await page.getByRole("button", { name: "Select all", exact: true }).click();
		await page.getByRole("button", { name: "Mark incomplete", exact: true }).click();
		for (const name of [
			"Mark incomplete",
			"Complete",
			"Select all",
			"Clear selection",
			"Delete",
			"Exit selection mode",
			"Sort Todo items",
			"Toggle Todo-item search",
		])
			await expect.element(page.getByRole("button", { name, exact: true })).toBeDisabled();
		await userEvent.keyboard("{Escape}{Enter}");
		expect(bulk).toHaveBeenCalledTimes(1);
		finish(
			status === "rejected"
				? { status, message: "Permission denied" }
				: { status, message: "Changed externally", confirmed: confirmedTodo([completed]) }
		);
		await expect
			.element(page.getByText(`${status === "rejected" ? 1 : 0} selected`, { exact: true }))
			.toBeVisible();
		await expect
			.element(page.getByRole("button", { name: "Mark incomplete", exact: true }))
			[status === "rejected" ? "toBeEnabled" : "toBeDisabled"]();
		if (status === "rejected") {
			await page.getByRole("button", { name: "Mark incomplete", exact: true }).click();
			expect(bulk).toHaveBeenCalledTimes(2);
			finish({ status: "rejected", message: "Still read-only" });
		}
	}
);

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
			restoreSession: async () => ({
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

test.each(["rejected", "conflict"] as const)(
	"pending bulk completion locks Escape and retains selection only on %s",
	async (status) => {
		let finish!: (result: Awaited<ReturnType<DesktopAPI["bulkSetTodoCompletion"]>>) => void;
		const bulk = vi.fn<DesktopAPI["bulkSetTodoCompletion"]>(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const createTodo = vi.fn<DesktopAPI["createTodo"]>();
		const undoTodo = vi.fn<DesktopAPI["undoTodo"]>();
		render(Harness, {
			shell: true,
			desktop: adapter({
				restoreSession: async () => ({ ...initial, undoLabel: "Undo edit" }),
				bulkSetTodoCompletion: bulk,
				createTodo,
				undoTodo,
			}),
		});
		await page.getByRole("button", { name: "Select items", exact: true }).click();
		await page.getByRole("checkbox", { name: "Select Plan release", exact: true }).click();
		const mod = /Mac/i.test(navigator.platform) ? "Meta" : "Control";
		await userEvent.keyboard(`{${mod}>}n{/${mod}}{${mod}>}z{/${mod}}`);
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
		expect(createTodo).not.toHaveBeenCalled();
		expect(undoTodo).not.toHaveBeenCalled();
		await page.getByRole("button", { name: "Complete", exact: true }).click();
		await userEvent.keyboard("{Escape}");
		await expect
			.element(page.getByRole("button", { name: "Exit selection mode", exact: true }))
			.toBeDisabled();
		await expect
			.element(page.getByRole("checkbox", { name: "Select Plan release", exact: true }))
			.toBeChecked();
		if (status === "rejected") finish({ status, message: "Permission denied" });
		else finish({ status, message: "Changed externally", confirmed: confirmedTodo([todo]) });
		await expect
			.element(page.getByRole("button", { name: "Exit selection mode", exact: true }))
			.toBeEnabled();
		await expect
			.element(page.getByText(`${status === "rejected" ? 1 : 0} selected`, { exact: true }))
			.toBeVisible();
		expect(bulk).toHaveBeenCalledTimes(1);
		await userEvent.keyboard("{Escape}");
		await expect
			.element(page.getByRole("button", { name: "Select items", exact: true }))
			.toBeVisible();
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	}
);

test("selection keyboard selects off-screen matches, suppresses editing, and preserves text input shortcuts", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const items = Array.from({ length: 200 }, (_, index) => ({
		...todo,
		line_number: index + 1,
		raw: `Batch ${index}`,
		description: `Batch ${index}`,
	}));
	const hidden = { ...todo, line_number: 201, raw: "Hidden", description: "Hidden" };
	const session: ConfirmedSession = {
		...initial,
		session: {
			...initial.session,
			todo_file: { path: "/tmp/work.todo", items: [...items, hidden], skipped: [] },
		},
	};
	const bulk = vi.fn<DesktopAPI["bulkSetTodoCompletion"]>(async () => ({
		status: "rejected",
		message: "Test rejection",
	}));
	render(Harness, {
		desktop: adapter({ restoreSession: async () => session, bulkSetTodoCompletion: bulk }),
	});
	await page.getByRole("button", { name: "Toggle Todo-item search", exact: true }).click();
	const search = page.getByRole("searchbox", { name: "Search Todo items", exact: true });
	await search.fill("Batch");
	await page.getByRole("button", { name: "Select items", exact: true }).click();
	const row = page.getByRole("button", { name: "Navigate Batch 0", exact: true });
	(row.element() as HTMLElement).focus();
	await userEvent.keyboard("{ArrowDown}{Space}{Enter}e");
	await expect.element(page.getByText("0 selected", { exact: true })).toBeVisible();
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	const mod = /Mac/i.test(navigator.platform) ? "Meta" : "Control";
	await userEvent.keyboard(`{${mod}>}a{/${mod}}`);
	await expect.element(page.getByText("200 selected", { exact: true })).toBeVisible();
	expect(document.querySelectorAll("[data-row-navigation]").length).toBeLessThan(200);
	await search.click();
	await userEvent.keyboard(`{${mod}>}a{/${mod}}`);
	expect((search.element() as HTMLInputElement).selectionEnd).toBe(5);
	await expect.element(page.getByText("200 selected", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Complete", exact: true }).click();
	await expect.poll(() => bulk.mock.calls.length).toBe(1);
	expect(bulk.mock.calls[0][0].targets).toHaveLength(200);
	expect(bulk.mock.calls[0][0].targets.some((target) => target.lineNumber === 201)).toBe(false);
});

test.each(["Cancel", "Escape"])(
	"bulk deletion %s writes nothing, preserves selection, and returns focus before Escape exits",
	async (dismiss) => {
		const bulkDeleteTodos = vi.fn<DesktopAPI["bulkDeleteTodos"]>();
		render(Harness, { desktop: adapter({ bulkDeleteTodos }) });
		await page.getByRole("button", { name: "Select items", exact: true }).click();
		const trigger = page.getByRole("button", { name: "Delete", exact: true });
		await expect.element(trigger).toBeDisabled();
		await page.getByRole("checkbox", { name: "Select Plan release", exact: true }).click();
		await trigger.click();
		const dialog = page.getByRole("alertdialog", { name: "Delete 1 Todo item?" });
		await expect.element(dialog).toBeVisible();
		await expect.element(dialog).toHaveFocus();
		await userEvent.keyboard("{Tab}");
		await expect.element(dialog.getByRole("button", { name: "Cancel", exact: true })).toHaveFocus();
		await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
		await expect.element(dialog.getByRole("button", { name: "Delete Todo items" })).toHaveFocus();
		await userEvent.keyboard("{Tab}");
		await expect.element(dialog.getByRole("button", { name: "Cancel", exact: true })).toHaveFocus();
		expect(bulkDeleteTodos).not.toHaveBeenCalled();
		if (dismiss === "Escape") await userEvent.keyboard("{Escape}");
		else await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect.element(dialog).not.toBeInTheDocument();
		await expect.element(trigger).toHaveFocus();
		// The closing animation retains the dialog's shortcut scope until its DOM is removed.
		await expect.poll(() => document.querySelector("[data-alert-dialog-content]")).toBeNull();
		await expect.element(page.getByText("1 selected", { exact: true })).toBeVisible();
		expect(bulkDeleteTodos).not.toHaveBeenCalled();
		await userEvent.keyboard("{Escape}");
		await expect
			.element(page.getByRole("button", { name: "Select items", exact: true }))
			.toBeVisible();
	}
);

test.each(["middle", "last", "all"] as const)(
	"bulk deletion focuses the nearest displayed row or Done after deleting %s",
	async (selection) => {
		if (initial.session.status !== "ready") throw Error("Expected Ready");
		const items = [
			todo,
			{
				...todo,
				line_number: 2,
				raw: "x 2026-10-16 Second",
				description: "Second",
				completed: true,
				completion_date: "2026-10-16",
			},
			{ ...todo, line_number: 3, raw: "Third", description: "Third" },
		];
		const selected = selection === "all" ? items : [items[selection === "middle" ? 1 : 2]];
		const remaining = items
			.filter((item) => !selected.includes(item))
			.map((item, index) => ({ ...item, line_number: index + 1 }));
		const bulkDeleteTodos = vi.fn<DesktopAPI["bulkDeleteTodos"]>(async () => ({
			status: "applied",
			confirmed: { ...confirmedTodo(remaining), undoLabel: "Undo deletion" },
		}));
		const deleteTodo = vi.fn<DesktopAPI["deleteTodo"]>();
		render(Harness, {
			desktop: adapter({
				restoreSession: async () => ({
					...initial,
					session: {
						...initial.session,
						todo_file: { path: "/tmp/work.todo", items, skipped: [] },
					},
				}),
				bulkDeleteTodos,
				deleteTodo,
			}),
		});
		await page.getByRole("button", { name: "Select items", exact: true }).click();
		if (selection === "all")
			await page.getByRole("button", { name: "Select all", exact: true }).click();
		else
			await page
				.getByRole("checkbox", { name: `Select ${selected[0].description}`, exact: true })
				.click();
		await page.getByRole("button", { name: "Delete", exact: true }).click();
		await expect
			.element(page.getByRole("alertdialog"))
			.toHaveAccessibleName(
				`Delete ${selected.length} ${selected.length === 1 ? "Todo item" : "Todo items"}?`
			);
		await page.getByRole("button", { name: "Delete Todo items", exact: true }).click();
		await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
		await expect
			.element(
				page.getByText(
					`Deleted ${selected.length} ${selected.length === 1 ? "Todo item" : "Todo items"}`,
					{ exact: true }
				)
			)
			.toBeVisible();
		await expect.element(page.getByText("0 selected", { exact: true })).toBeVisible();
		await expect
			.element(
				page.getByRole("button", {
					name:
						selection === "all"
							? "Exit selection mode"
							: `Navigate ${selection === "middle" ? "Third" : "Second"}`,
					exact: true,
				})
			)
			.toHaveFocus();
		expect(bulkDeleteTodos).toHaveBeenCalledExactlyOnceWith({
			scope,
			revision: 1,
			workspaceId,
			targets: selected.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
		});
		expect(deleteTodo).not.toHaveBeenCalled();
	}
);

test.each(["rejected", "conflict"] as const)(
	"pending bulk deletion locks controls and duplicate submission; handles %s",
	async (status) => {
		let finish!: (result: Awaited<ReturnType<DesktopAPI["bulkDeleteTodos"]>>) => void;
		const bulkDeleteTodos = vi.fn<DesktopAPI["bulkDeleteTodos"]>(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		render(Harness, { shell: true, desktop: adapter({ bulkDeleteTodos }) });
		await page.getByRole("button", { name: "Toggle Todo-item search", exact: true }).click();
		await page.getByRole("button", { name: "Select items", exact: true }).click();
		await page.getByRole("checkbox", { name: "Select Plan release", exact: true }).click();
		await page.getByRole("button", { name: "Delete", exact: true }).click();
		const submit = page.getByRole("button", { name: "Delete Todo items", exact: true }).element();
		await page.getByRole("button", { name: "Delete Todo items", exact: true }).click();
		submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await expect
			.element(page.getByRole("button", { name: "Deleting…", exact: true }))
			.toBeDisabled();
		await expect.element(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
		for (const name of [
			"Select all",
			"Clear selection",
			"Complete",
			"Delete",
			"Exit selection mode",
			"Sort Todo items",
			"Show deferred",
			"Saved views",
			"Toggle Todo-item search",
		]) {
			await expect
				.element(page.getByRole("button", { name, exact: true, includeHidden: true }))
				.toBeDisabled();
		}
		await expect
			.element(page.getByRole("searchbox", { name: "Search Todo items", includeHidden: true }))
			.toBeDisabled();
		await expect
			.element(
				page.getByRole("checkbox", {
					name: "Select Plan release",
					exact: true,
					includeHidden: true,
				})
			)
			.toBeDisabled();
		await expect
			.element(page.getByRole("status").filter({ hasText: "Deleting selected Todo items…" }))
			.toBeVisible();
		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByRole("alertdialog")).toBeVisible();
		expect(bulkDeleteTodos).toHaveBeenCalledTimes(1);
		if (status === "rejected") {
			finish({ status, message: "Permission denied" });
			await expect
				.element(page.getByRole("alertdialog").getByRole("alert"))
				.toHaveTextContent("Permission denied");
			await expect
				.element(page.getByRole("button", { name: "Delete Todo items", exact: true }))
				.toBeEnabled();
			await page.getByRole("button", { name: "Cancel", exact: true }).click();
			await expect.element(page.getByText("1 selected", { exact: true })).toBeVisible();
			await page.getByRole("button", { name: "Delete", exact: true }).click();
			await page.getByRole("button", { name: "Delete Todo items", exact: true }).click();
			expect(bulkDeleteTodos).toHaveBeenCalledTimes(2);
			finish({ status: "applied", confirmed: confirmedTodo([]) });
			await expect.element(page.getByText("Deleted 1 Todo item", { exact: true })).toBeVisible();
		} else {
			finish({ status, message: "Changed externally", confirmed: confirmedTodo([todo]) });
			await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
			await expect.element(page.getByText("0 selected", { exact: true })).toBeVisible();
			await expect.element(page.getByText("Todo file reloaded", { exact: true })).toBeVisible();
			await expect
				.element(page.getByRole("button", { name: "Delete", exact: true }))
				.toBeDisabled();
			await expect
				.element(page.getByRole("button", { name: "Exit selection mode", exact: true }))
				.toHaveFocus();
		}
	}
);

test("unchanged refresh preserves deletion confirmation; changed contents dismiss it and require fresh selection", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const ready = initial.session;
	let notify!: (change: TodoFileChange) => void;
	let loads = 0;
	const bulkDeleteTodos = vi.fn<DesktopAPI["bulkDeleteTodos"]>();
	render(Harness, {
		desktop: adapter({
			bulkDeleteTodos,
			restoreSession: async () => ({
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
	notify({ scope, revision: 1, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.poll(() => loads).toBe(2);
	await expect
		.element(page.getByRole("alertdialog", { name: "Delete 1 Todo item?" }))
		.toBeVisible();
	await expect
		.element(page.getByRole("button", { name: "Delete Todo items", exact: true }))
		.toBeEnabled();
	notify({ scope, revision: 2, workspaceId, todoPath: "/tmp/work.todo" });
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
			restoreSession: async () => ({
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
	notify({ scope, revision: 1, workspaceId, todoPath: "/tmp/work.todo" });
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

test("unchanged refresh retains selection and a skipped-line edit clears it with a notice", async () => {
	if (initial.session.status !== "ready") throw Error("Expected Ready");
	const ready = initial.session;
	let notify!: (change: TodoFileChange) => void;
	let loads = 0;
	const restoreSession = vi.fn<DesktopAPI["restoreSession"]>(async () => ({
		...initial,
		revision: ++loads,
		session: {
			...ready,
			todo_file: {
				...ready.todo_file,
				skipped: [{ line_number: 2, raw: loads < 3 ? "x" : "x ", reason: "Invalid Todo item" }],
			},
		},
	}));
	render(Harness, {
		desktop: adapter({ restoreSession }),
		observation: {
			onTodoFileChanged(listener) {
				notify = listener;
				return () => {};
			},
		},
	});
	await page.getByRole("button", { name: "Select items", exact: true }).click();
	await page.getByRole("checkbox", { name: "Select Plan release", exact: true }).click();
	notify({ scope, revision: 1, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.poll(() => loads).toBe(2);
	await expect.element(page.getByText("1 selected", { exact: true })).toBeVisible();
	notify({ scope, revision: 2, workspaceId, todoPath: "/tmp/work.todo" });
	await expect.element(page.getByText("0 selected", { exact: true })).toBeVisible();
	await expect
		.element(page.getByText("Selection cleared because the Todo file changed.", { exact: true }))
		.toBeVisible();
});
