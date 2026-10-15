import { onDestroy, tick } from "svelte";
import type { TodoItem } from "$lib/modules/todo/domain/todo";
import type TodoList from "$lib/modules/todo/ui/TodoList.svelte";
import type { TodoItemDraft, SaveTodoItemResult } from "$lib/modules/todo/ui/todo-editor-types";
import type { ShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
import type { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";

type Inputs = {
	readonly workspace: ElectronWorkspaceSessionState;
	readonly fileOrder: boolean;
	readonly wide: boolean;
	readonly list: ReturnType<typeof TodoList> | undefined;
	readonly viewport: HTMLElement | null;
	readonly details: HTMLElement | null;
	readonly shortcutScope: ShortcutScope | undefined;
};

// Created during reader initialization; inputs are reactive getters over the session and DOM.
export function createTodoReaderInteraction(inputs: Inputs) {
	let selected = $state.raw<TodoItem | null>(null);
	let selectedWorkspaceId = $state<string>();
	let selectedPath = $state<string>();
	let editing = $state.raw<TodoItem | null>(null);
	let editingWorkspaceId = $state<string>();
	let editingPath = $state<string>();
	let editRecovery: ReturnType<NonNullable<Inputs["list"]>["captureFocus"]> | undefined;
	let detailEditTrigger: HTMLButtonElement | null = null;
	let reconciling = $state(false);
	let previousWide: boolean | undefined;
	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
		editRecovery?.cancel();
	});
	const selectedTodo = $derived(
		selectedWorkspaceId === inputs.workspace.activeWorkspace?.id &&
			selectedPath === inputs.workspace.todoFile?.path
			? (inputs.workspace.todoFile?.items.find(
					(item) => item.line_number === selected?.line_number && item.raw === selected?.raw
				) ?? (reconciling ? selected : null))
			: null
	);
	const editingTodo = $derived(
		editingWorkspaceId === inputs.workspace.activeWorkspace?.id &&
			editingPath === inputs.workspace.todoFile?.path
			? editing
			: null
	);

	function select(todo: TodoItem) {
		selected = todo;
		selectedWorkspaceId = inputs.workspace.activeWorkspace?.id;
		selectedPath = inputs.workspace.todoFile?.path;
	}
	function closeDetails() {
		const todo = selectedTodo;
		selected = null;
		if (todo) void inputs.list?.focusTodo(todo);
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
		if (selected && !selectedTodo && !reconciling) {
			if (document.activeElement?.closest("[data-todo-details]")) inputs.viewport?.focus();
			selected = null;
		}
	});

	async function change(
		todo: TodoItem,
		mutate: () => Promise<SaveTodoItemResult>,
		line: number | null = todo.line_number,
		recovery?: ReturnType<NonNullable<Inputs["list"]>["captureFocus"]>,
		trigger?: HTMLButtonElement | null
	) {
		const workspaceId = inputs.workspace.activeWorkspace?.id;
		const path = inputs.workspace.todoFile?.path;
		reconciling = true;
		try {
			const result = await mutate();
			if (
				!destroyed &&
				workspaceId === inputs.workspace.activeWorkspace?.id &&
				path === inputs.workspace.todoFile?.path &&
				selectedWorkspaceId === workspaceId &&
				selectedPath === path &&
				selected?.line_number === todo.line_number &&
				selected.raw === todo.raw
			) {
				if (result.status === "applied") {
					selected =
						line === null
							? null
							: (inputs.workspace.todoFile?.items.find((item) => item.line_number === line) ??
								null);
					if (line === null && trigger?.closest("[data-todo-details]")) inputs.viewport?.focus();
				} else if (result.status === "conflict") selected = null;
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
			reconciling = false;
		}
	}
	function startEdit(todo: TodoItem, trigger: HTMLButtonElement | null) {
		editRecovery?.cancel();
		detailEditTrigger = trigger?.closest("[data-todo-details]") ? trigger : null;
		editRecovery = detailEditTrigger ? undefined : inputs.list?.captureFocus(todo, true, trigger);
		editingWorkspaceId = inputs.workspace.activeWorkspace?.id;
		editingPath = inputs.workspace.todoFile?.path;
		editing = todo;
	}
	function closeEdit(uncertain = false) {
		editing = null;
		if (detailEditTrigger) {
			const trigger = detailEditTrigger;
			detailEditTrigger = null;
			const workspaceId = editingWorkspaceId;
			const path = editingPath;
			void tick().then(() => {
				if (
					destroyed ||
					workspaceId !== inputs.workspace.activeWorkspace?.id ||
					path !== inputs.workspace.todoFile?.path
				)
					return;
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
