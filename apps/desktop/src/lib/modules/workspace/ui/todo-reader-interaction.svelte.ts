import { getPanelRouting } from "./todo-panel-routing.svelte.js";
import { onDestroy, tick } from "svelte";
import type { TodoItem } from "#lib/modules/todo/domain/todo.js";
import type TodoList from "#lib/modules/todo/ui/TodoList.svelte";
import type { TodoItemDraft, SaveTodoItemResult } from "#lib/modules/todo/ui/todo-editor-types.js";
import type { ShortcutScope } from "#lib/shared/shortcuts/shortcut-scope.svelte.js";
import type { WorkspaceCommands } from "../state/workspace-commands.svelte";
import type { WorkspaceView } from "../state/workspace-view.js";

type Inputs = {
	readonly workspace: WorkspaceCommands;
	readonly view: WorkspaceView;
	readonly fileOrder: boolean;
	readonly wide: boolean;
	readonly list: ReturnType<typeof TodoList> | undefined;
	readonly viewport: HTMLElement | null;
	readonly details: HTMLElement | null;
	readonly shortcutScope: ShortcutScope | undefined;
};

// A selection or edit belongs to the Workspace and Todo file it was made in; it is stale elsewhere.
type Scope = { workspaceId: string | undefined; path: string | undefined };
type Tracked = { todo: TodoItem; scope: Scope };
const sameScope = (a: Scope, b: Scope) => a.workspaceId === b.workspaceId && a.path === b.path;
const sameTodo = (
	a: Pick<TodoItem, "line_number" | "raw"> | null | undefined,
	b: Pick<TodoItem, "line_number" | "raw"> | null | undefined
) => !!a && !!b && a.line_number === b.line_number && a.raw === b.raw;

// Created during reader initialization; inputs are reactive getters over the session and DOM.
export function createTodoReaderInteraction(inputs: Inputs) {
	const panel = getPanelRouting();
	let localSelection = $state.raw<Tracked | null>(null);
	const selection = $derived(panel ? panel.selection() : localSelection);
	function setSelection(value: Tracked | null) {
		if (panel) return panel.set(value);
		localSelection = value;
	}
	let editing = $state.raw<Tracked | null>(null);
	let editRecovery: ReturnType<NonNullable<Inputs["list"]>["captureFocus"]> | undefined;
	let detailEditTrigger: HTMLButtonElement | null = null;
	let writing = $state(false);
	let writingTodo = $state.raw<TodoItem | null>(null);
	let previousWide: boolean | undefined;
	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
		editRecovery?.cancel();
	});
	const currentScope = (): Scope => ({
		workspaceId: inputs.view.activeWorkspace?.id,
		path: inputs.view.todoFile?.path,
	});
	const selectedTodo = $derived(
		selection && sameScope(selection.scope, currentScope())
			? (inputs.view.todoFile?.items.find((item) => sameTodo(item, selection?.todo)) ??
					(writing && sameTodo(writingTodo, selection.todo) ? writingTodo : null))
			: null
	);
	const editingTodo = $derived(
		editing && sameScope(editing.scope, currentScope()) ? editing.todo : null
	);

	function select(todo: TodoItem) {
		if (inputs.workspace.isOperating) return;
		void setSelection({ todo, scope: currentScope() });
	}
	async function closeDetails() {
		const todo = selectedTodo;
		if (inputs.workspace.isOperating) return;
		await setSelection(null);
		if (todo && !destroyed && !selectedTodo) void inputs.list?.focusTodo(todo);
	}
	// DOM focus must leave an invalid details surface before it is removed or changes presentation.
	$effect.pre(() => {
		const isWide = inputs.wide;
		if (previousWide !== isWide) {
			const ownedFocus = document.activeElement?.closest("[data-todo-details]");
			previousWide = isWide;
			if (isWide && ownedFocus)
				void tick().then(() => {
					if (!destroyed) inputs.details?.querySelector<HTMLButtonElement>("button")?.focus();
				});
		}
		if (
			(selection || panel?.hasSelection) &&
			!selectedTodo &&
			!writing &&
			!inputs.workspace.isOperating &&
			inputs.view.todoFile
		) {
			if (document.activeElement?.closest("[data-todo-details]")) inputs.viewport?.focus();
			void setSelection(null);
		}
	});

	async function change(
		todo: TodoItem,
		mutate: () => Promise<SaveTodoItemResult>,
		line: number | null = todo.line_number,
		recovery?: ReturnType<NonNullable<Inputs["list"]>["captureFocus"]>,
		trigger?: HTMLButtonElement | null
	) {
		const startScope = currentScope();
		writingTodo = todo;
		writing = true;
		try {
			const result = await mutate();
			// A write only moves the selection when it targeted this selection in this same scope.
			if (
				!destroyed &&
				selection &&
				sameScope(startScope, currentScope()) &&
				sameScope(selection.scope, startScope) &&
				sameTodo(selection.todo, todo)
			) {
				if (result.status === "applied") {
					const moved =
						line === null
							? null
							: (inputs.view.todoFile?.items.find((item) => item.line_number === line) ?? null);
					await setSelection(moved && { todo: moved, scope: selection.scope });
					if (line === null && trigger?.closest("[data-todo-details]")) inputs.viewport?.focus();
				} else if (result.status === "conflict") void setSelection(null);
			}
			if (!destroyed)
				void recovery?.restore(
					result.status === "conflict",
					line === null && result.status === "applied"
				);
			return result;
		} catch (error) {
			recovery?.cancel();
			throw error;
		} finally {
			writing = false;
			writingTodo = null;
		}
	}
	function startEdit(todo: TodoItem, trigger: HTMLButtonElement | null) {
		editRecovery?.cancel();
		detailEditTrigger = trigger?.closest("[data-todo-details]") ? trigger : null;
		editRecovery = detailEditTrigger ? undefined : inputs.list?.captureFocus(todo, true, trigger);
		editing = { todo, scope: currentScope() };
	}
	function closeEdit(uncertain = false) {
		const scope = editing?.scope;
		editing = null;
		if (detailEditTrigger) {
			const trigger = detailEditTrigger;
			detailEditTrigger = null;
			void tick().then(() => {
				if (destroyed || !scope || !sameScope(scope, currentScope())) return;
				if (!uncertain && trigger.isConnected) trigger.focus();
				else inputs.viewport?.focus();
			});
		} else void editRecovery?.restore(uncertain);
		editRecovery = undefined;
	}
	return {
		get selectedTodo() {
			return selectedTodo;
		},
		get editingTodo() {
			return editingTodo;
		},
		select,
		closeDetails,
		startEdit,
		closeEdit,
		saveEdit: (draft: TodoItemDraft) => {
			const todo = editingTodo!;
			return change(todo, () => inputs.workspace.editTodo(todo, draft));
		},
		toggleCompletion: (todo: TodoItem) =>
			change(
				todo,
				() => inputs.workspace.setCompletion(todo),
				todo.line_number,
				inputs.list?.captureFocus(todo)
			),
		deleteTodo: (todo: TodoItem, trigger?: HTMLButtonElement | null) =>
			change(
				todo,
				() => inputs.workspace.deleteTodo(todo),
				null,
				inputs.list?.captureFocus(todo, false, trigger),
				trigger
			),
		reorder: (items: readonly TodoItem[]) => {
			if (!inputs.fileOrder) return;
			const todo = selectedTodo;
			const index = todo
				? items.findIndex((item) => item.line_number === todo.line_number && item.raw === todo.raw)
				: -1;
			const lines = items.map((item) => item.line_number).sort((a, b) => a - b);
			// No selected identity needs retargeting when details are closed.
			return todo
				? change(
						todo,
						() => inputs.workspace.reorderTodo(items),
						index < 0 ? todo.line_number : lines[index]
					)
				: inputs.workspace.reorderTodo(items);
		},
		navigate: (todo: TodoItem) => {
			if (selectedTodo && inputs.wide) select(todo);
		},
		keydown: (event: KeyboardEvent) => {
			if (
				event.key === "Escape" &&
				inputs.wide &&
				selectedTodo &&
				!editingTodo &&
				(inputs.shortcutScope?.available ?? true) &&
				!event.defaultPrevented
			) {
				event.preventDefault();
				closeDetails();
			}
		},
	};
}
