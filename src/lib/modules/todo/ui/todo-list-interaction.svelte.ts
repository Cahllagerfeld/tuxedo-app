import { onMount, tick } from "svelte";
import { createHotkeysAttachment } from "@tanstack/svelte-hotkeys";
import type { TodoItem } from "../domain/todo";
import { shortcutSurfaceOpen } from "$lib/shared/keyboard";
import { todoShortcuts } from "./todo-shortcuts";
import { createTodoListVirtualization } from "./todo-list-virtualization.svelte";

export type TodoItemAction = (item: TodoItem) => void | Promise<boolean | void>;

type TodoListInteractionInputs = Readonly<{
	items: readonly TodoItem[];
	todoFilePath: string;
	scrollElement: HTMLElement | null;
	list: HTMLUListElement | null;
	workspaceKey: string;
	disabled: boolean;
	onToggleComplete: TodoItemAction;
	onDelete: TodoItemAction;
}>;

// Create during component initialization; getters follow confirmed items and DOM refs.
export function createTodoListInteraction(inputs: TodoListInteractionInputs) {
	const virtualization = createTodoListVirtualization(inputs);
	let focusVersion = 0;
	let localOperation = false;
	let focusedRow = $state<number | null>(null);

	async function focusIndex(index: number) {
		const item = inputs.items[index];
		if (!item || !inputs.list) return;
		const version = focusVersion;
		const scope = inputs.workspaceKey;
		virtualization.focusItem(item);
		virtualization.scrollToItem(index);
		await tick();
		if (scope !== inputs.workspaceKey || version !== focusVersion) return;
		inputs.list.querySelector<HTMLElement>(`[data-todo-line="${item.line_number}"]`)?.focus();
	}

	async function act(item: TodoItem, deleting: boolean) {
		if (inputs.disabled || localOperation) return;
		const active = document.activeElement;
		const ownedFocus = !!active && !!inputs.list?.contains(active);
		const version = focusVersion;
		const scope = inputs.workspaceKey;
		const index = inputs.items.indexOf(item);
		localOperation = true;
		try {
			const applied = await (deleting ? inputs.onDelete(item) : inputs.onToggleComplete(item));
			await tick();
			if (
				applied === false ||
				!ownedFocus ||
				version !== focusVersion ||
				scope !== inputs.workspaceKey
			)
				return;
			if (!deleting && active?.isConnected && document.activeElement === active) return;
			if (document.activeElement !== document.body && document.activeElement !== active) return;
			const remaining = inputs.items.findIndex(
				(candidate) => candidate.line_number === item.line_number
			);
			if (inputs.items.length)
				await focusIndex(
					deleting
						? Math.min(index, inputs.items.length - 1)
						: remaining >= 0
							? remaining
							: Math.min(index, inputs.items.length - 1)
				);
			else inputs.list?.focus();
		} finally {
			localOperation = false;
		}
	}

	function handleKey(
		id: "previous" | "next" | "first" | "last" | "completion",
		event: KeyboardEvent
	) {
		if (shortcutSurfaceOpen() || event.defaultPrevented || !(event.target instanceof HTMLElement))
			return;
		// Nested buttons, checkboxes, and editable content keep their native behavior.
		if (event.target !== inputs.list && !event.target.matches("[data-todo-line]")) return;
		if (inputs.disabled || localOperation) return;
		event.preventDefault();
		const index = inputs.items.findIndex((item) => item.line_number === focusedRow);
		if (id === "completion") {
			if (!event.repeat && index >= 0) void act(inputs.items[index], false);
			return;
		}
		const target =
			id === "first"
				? 0
				: id === "last"
					? inputs.items.length - 1
					: index < 0
						? 0
						: index + (id === "next" ? 1 : -1);
		void focusIndex(Math.max(0, Math.min(inputs.items.length - 1, target)));
	}
	const navigation = createHotkeysAttachment(
		(["previous", "next", "first", "last", "completion"] as const).map((id) => ({
			hotkey: todoShortcuts[id].binding,
			callback: (event) => handleKey(id, event),
		})),
		() => ({ enabled: !inputs.disabled, preventDefault: false, stopPropagation: false })
	);

	function invalidateFocusRecovery() {
		focusVersion++;
	}
	// Track external DOM interaction for the lifetime of this list.
	onMount(() => {
		document.addEventListener("pointerdown", invalidateFocusRecovery);
		document.addEventListener("focusin", invalidateFocusRecovery);
		return () => {
			document.removeEventListener("pointerdown", invalidateFocusRecovery);
			document.removeEventListener("focusin", invalidateFocusRecovery);
		};
	});

	return {
		get rows() {
			return virtualization.rows;
		},
		get totalSize() {
			return virtualization.totalSize;
		},
		navigation,
		onListFocus(event: FocusEvent) {
			if (event.target === inputs.list) focusedRow = null;
		},
		onRowFocus(item: TodoItem) {
			focusedRow = item.line_number;
			virtualization.focusItem(item);
		},
		onRowFocusOut: virtualization.onFocusOut,
		preventRepeatedCheckboxActivation(event: KeyboardEvent) {
			// Bits UI activates checkboxes on keydown; a held Space must mutate only once.
			if (
				event.repeat &&
				event.key === " " &&
				event.target instanceof HTMLElement &&
				event.target.closest('[role="checkbox"]')
			) {
				event.preventDefault();
				event.stopPropagation();
			}
		},
		toggleCompletion(item: TodoItem) {
			void act(item, false);
		},
		deleteItem(item: TodoItem) {
			void act(item, true);
		},
	};
}
