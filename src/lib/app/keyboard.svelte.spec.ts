import { page, userEvent } from "vitest/browser";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { ConfirmedSession, DesktopAPI, TodoFile } from "$lib/shared/desktop/contract";
import { shortcutPlatform } from "$lib/shared/keyboard";
import Harness from "./KeyboardHarness.svelte";
import AppShortcuts from "./AppShortcuts.svelte";
import "../../routes/layout.css";

const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const items: TodoFile["items"] = ["Plan", "Build", "Ship"].map((description, index) => ({
	line_number: index + 1,
	raw: description,
	description,
	completed: false,
	priority: null,
	creation_date: null,
	completion_date: null,
	projects: [],
	contexts: [],
	metadata: {},
}));
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
		todo_file: { path: "/tmp/work.todo", items, skipped: [] },
	},
};
function desktop(overrides: Partial<DesktopAPI> = {}): DesktopAPI {
	return {
		readSession: async () => initial,
		restoreSession: async () => initial,
		selectTodoFile: async () => null,
		createWorkspace: async () => ({ status: "rejected", message: "unused" }),
		switchWorkspace: async () => ({ status: "rejected", message: "unused" }),
		deleteWorkspace: async () => ({ status: "rejected", message: "unused" }),
		setTodoCompletion: async () => ({ status: "rejected", message: "Denied" }),
		deleteTodo: async () => ({ status: "rejected", message: "Denied" }),
		createTodo: async () => ({ status: "rejected", message: "unused" }),
		...overrides,
	};
}
const mod = shortcutPlatform === "mac" ? "Meta" : "Control";
test.each(["mac", "windows", "linux"] as const)("%s bindings and hints agree", async (platform) => {
	const openSwitcher = vi.fn();
	const openCreation = vi.fn();
	await render(AppShortcuts, { disabled: false, platform, openSwitcher, openCreation });
	const modifier = platform === "mac" ? "Meta" : "Control";
	await userEvent.keyboard(`{${modifier}>}p{/${modifier}}`);
	expect(openSwitcher).toHaveBeenCalledTimes(1);
	await userEvent.keyboard(`{${modifier}>}{Shift>}N{/Shift}{/${modifier}}`);
	expect(openCreation).toHaveBeenCalledTimes(1);
	await userEvent.keyboard(`{${modifier}>}/{/${modifier}}`);
	const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
	await expect.element(dialog).toBeVisible();
	await expect.element(dialog.getByLabelText(platform === "mac" ? "⌘ P" : "Ctrl+P")).toBeVisible();
	await expect
		.element(dialog.getByLabelText(platform === "mac" ? "⇧ ⌘ N" : "Ctrl+Shift+N"))
		.toBeVisible();
});
async function chord(key: string, shift = false) {
	await userEvent.keyboard(
		`{${mod}>}${shift ? "{Shift>}" : ""}${shift ? key.toUpperCase() : key}${shift ? "{/Shift}" : ""}{/${mod}}`
	);
}
function confirmed(updated: TodoFile["items"]) {
	return {
		scope,
		revision: 2,
		workspaceId,
		todo_file: { path: "/tmp/work.todo", items: updated, skipped: [] },
	};
}

test("shell shortcuts open real surfaces, suppress background actions, and restore focus", async () => {
	await page.viewport(1100, 800);
	await render(Harness, { desktop: desktop() });
	const switcher = page.getByRole("button", { name: /Select workspace: Work/ });
	await expect.element(switcher).toBeEnabled();
	await chord("p");
	await expect.element(page.getByRole("menu")).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await expect.element(switcher).toHaveFocus();
	await chord("n", true);
	await expect.element(page.getByRole("dialog", { name: "Create workspace" })).toBeVisible();
	await chord("/");
	await expect
		.element(page.getByRole("dialog", { name: "Keyboard shortcuts" }))
		.not.toBeInTheDocument();
	await userEvent.keyboard("hello {ArrowDown}{Space}");
	await expect
		.element(page.getByRole("textbox", { name: "Workspace name" }))
		.toHaveValue("hello  ");
	await userEvent.keyboard("{Escape}");
	await expect.element(switcher).toHaveFocus();
	await chord("/");
	await expect.element(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
	await expect.element(page.getByText("Toggle Todo-item completion")).toBeVisible();
	await chord("p");
	await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
	await userEvent.keyboard("{Escape}");
	await expect.element(page.getByRole("button", { name: /Keyboard shortcuts/ })).toHaveFocus();
});

test("completion recovers neighboring focus when the confirmed Open view changes", async () => {
	const complete = vi.fn<DesktopAPI["setTodoCompletion"]>(async () => ({
		status: "applied",
		confirmed: confirmed([{ ...items[0], completed: true }, ...items.slice(1)]),
	}));
	await render(Harness, { desktop: desktop({ setTodoCompletion: complete }) });
	const list = page.getByRole("list", { name: "Todo items" });
	await expect.element(list).toBeVisible();
	(list.element() as HTMLElement).focus();
	await userEvent.keyboard("{ArrowDown}{Space}");
	await expect.element(page.getByRole("listitem").filter({ hasText: "Build" })).toHaveFocus();
	expect(complete).toHaveBeenCalledTimes(1);
});

test("button deletion focuses the next row after line numbers shift", async () => {
	await render(Harness, {
		desktop: desktop({
			deleteTodo: async () => ({
				status: "applied",
				confirmed: confirmed(
					items.slice(1).map((item, index) => ({ ...item, line_number: index + 1 }))
				),
			}),
		}),
	});
	await page.getByRole("button", { name: "Delete Plan", exact: true }).click();
	await expect.element(page.getByRole("listitem").filter({ hasText: "Build" })).toHaveFocus();
});

test("keyboard rejection uses existing feedback and held Space does not repeat", async () => {
	const complete = vi.fn<DesktopAPI["setTodoCompletion"]>(async () => ({
		status: "rejected",
		message: "Denied",
	}));
	await render(Harness, { desktop: desktop({ setTodoCompletion: complete }) });
	const list = page.getByRole("list", { name: "Todo items" });
	await expect.element(list).toBeVisible();
	(list.element() as HTMLElement).focus();
	await userEvent.keyboard("{ArrowDown}{Space>}");
	await expect.element(page.getByText("Could not update Todo item")).toBeVisible();
	(document.activeElement as HTMLElement).dispatchEvent(
		new KeyboardEvent("keydown", { key: " ", code: "Space", repeat: true, bubbles: true })
	);
	await userEvent.keyboard("{/Space}");
	expect(complete).toHaveBeenCalledTimes(1);
	await expect.element(list.getByRole("listitem").nth(0)).toHaveFocus();
});

test("loading blocks Workspace shortcuts and remount does not duplicate bindings", async () => {
	const loading = await render(Harness, {
		desktop: desktop({ restoreSession: () => new Promise(() => {}) }),
	});
	await expect.element(page.getByLabelText("Loading workspace session")).toBeVisible();
	await chord("p");
	await chord("n", true);
	await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	await loading.unmount();
	const view = await render(Harness, { desktop: desktop() });
	await expect.element(page.getByRole("button", { name: /Select workspace: Work/ })).toBeEnabled();
	await chord("p");
	await expect.element(page.getByRole("menu")).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await view.unmount();
	const event = new KeyboardEvent("keydown", {
		key: "p",
		code: "KeyP",
		metaKey: mod === "Meta",
		ctrlKey: mod === "Control",
		bubbles: true,
		cancelable: true,
	});
	document.dispatchEvent(event);
	expect(event.defaultPrevented).toBe(false);
});

test("modifier shortcuts work while typing but use only the platform modifier", async () => {
	await render(Harness, { desktop: desktop() });
	const input = page.getByRole("searchbox", { name: "Find a filter" });
	await input.click();
	const other = mod === "Meta" ? "Control" : "Meta";
	await userEvent.keyboard(`{${other}>}p{/${other}}`);
	await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
	await chord("p");
	await expect.element(page.getByRole("menu")).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await page.getByRole("button", { name: /Keyboard shortcuts/ }).click();
	const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
	await expect.element(help.getByLabelText(mod === "Meta" ? "⌘ P" : "Ctrl+P")).toBeVisible();
});

test("pending completion admits one mutation and does not reclaim focus moved outside the list", async () => {
	let finish!: (result: Awaited<ReturnType<DesktopAPI["setTodoCompletion"]>>) => void;
	const complete = vi.fn<DesktopAPI["setTodoCompletion"]>(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			})
	);
	await render(Harness, { desktop: desktop({ setTodoCompletion: complete }) });
	const list = page.getByRole("list", { name: "Todo items" });
	await expect.element(list).toBeVisible();
	(list.element() as HTMLElement).focus();
	await userEvent.keyboard("{ArrowDown}{Space}{Space}");
	await chord("n", true);
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	const help = page.getByRole("button", { name: /Keyboard shortcuts/ });
	(help.element() as HTMLElement).focus();
	finish({
		status: "applied",
		confirmed: confirmed([{ ...items[0], completed: true }, ...items.slice(1)]),
	});
	await expect.element(page.getByText("Plan", { exact: true })).not.toBeInTheDocument();
	await expect.element(help).toHaveFocus();
	expect(complete).toHaveBeenCalledTimes(1);
});

test("deleting the last visible item uses the focusable empty-list fallback", async () => {
	const single = {
		...initial,
		session: {
			...initial.session,
			todo_file: { path: "/tmp/work.todo", items: [items[0]], skipped: [] },
		},
	};
	await render(Harness, {
		desktop: desktop({
			restoreSession: async () => single,
			deleteTodo: async () => ({ status: "applied", confirmed: confirmed([]) }),
		}),
	});
	await page.getByRole("button", { name: "Delete Plan", exact: true }).click();
	await expect.element(page.getByRole("list", { name: "Todo items" })).toHaveFocus();
	await expect.element(page.getByLabelText("No valid Todo items")).toBeVisible();
});

test("pending completion does not reclaim focus after clicking a nonfocusable area", async () => {
	let finish!: (result: Awaited<ReturnType<DesktopAPI["setTodoCompletion"]>>) => void;
	await render(Harness, {
		desktop: desktop({
			setTodoCompletion: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		}),
	});
	const list = page.getByRole("list", { name: "Todo items" });
	await expect.element(list).toBeVisible();
	(list.element() as HTMLElement).focus();
	await userEvent.keyboard("{ArrowDown}{Space}");
	await page.getByRole("banner").getByText("Tuxedo", { exact: true }).click();
	expect(document.activeElement).toBe(document.body);
	finish({
		status: "applied",
		confirmed: confirmed([{ ...items[0], completed: true }, ...items.slice(1)]),
	});
	await expect.element(page.getByText("Plan", { exact: true })).not.toBeInTheDocument();
	expect(document.activeElement).toBe(document.body);
});

test("native delete activation focuses the previous row when deleting the last row", async () => {
	const remove = vi.fn<DesktopAPI["deleteTodo"]>(async () => ({
		status: "applied",
		confirmed: confirmed(items.slice(0, 2)),
	}));
	await render(Harness, { desktop: desktop({ deleteTodo: remove }) });
	const button = page.getByRole("button", { name: "Delete Ship", exact: true });
	await expect.element(button).toBeInTheDocument();
	(button.element() as HTMLElement).focus();
	await userEvent.keyboard("{Enter}");
	await expect
		.element(
			page
				.getByRole("list", { name: "Todo items" })
				.getByRole("listitem")
				.filter({ hasText: "Build" })
		)
		.toHaveFocus();
	expect(remove).toHaveBeenCalledTimes(1);
});

test("external-edit conflict reports the existing notice without another mutation", async () => {
	const complete = vi.fn<DesktopAPI["setTodoCompletion"]>(async () => ({
		status: "conflict",
		message: "Todo file changed externally",
		confirmed: confirmed([
			{ ...items[0], description: "Changed externally", raw: "Changed externally" },
			...items.slice(1),
		]),
	}));
	await render(Harness, { desktop: desktop({ setTodoCompletion: complete }) });
	const list = page.getByRole("list", { name: "Todo items" });
	await expect.element(list).toBeVisible();
	(list.element() as HTMLElement).focus();
	await userEvent.keyboard("{ArrowDown}{Space}");
	await expect
		.element(page.getByText("Todo file changed externally; reloaded latest version"))
		.toBeVisible();
	await expect.element(page.getByText("Changed externally", { exact: true })).toBeVisible();
	expect(complete).toHaveBeenCalledTimes(1);
});
