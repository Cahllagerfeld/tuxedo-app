import { tick, onMount, onDestroy } from "svelte";
import { rowShortcuts } from "./shortcuts";
import type { TodoItem, TodoFile } from "../domain/todo";
import type { ShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";

type Inputs = {
	readonly items: readonly TodoItem[];
	readonly todoFile: TodoFile;
	readonly workspaceId: string;
	readonly root: HTMLElement | null;
	readonly fallback: HTMLElement | null;
	readonly disabled: boolean;
	readonly dragging: boolean;
	readonly scope: ShortcutScope | undefined;
	reveal: (todo: TodoItem) => void;
	onToggle: (todo: TodoItem) => void;
	onEdit?: (todo: TodoItem, trigger: HTMLButtonElement | null) => void;
};

export function createTodoListFocus(inputs: Inputs) {
	let navigationIndex = $state(-1);
	let recovering = false;
	let ownedFocus = false;
	const pending = new Set<() => void>();
	onMount(() => {
		const track = () => {
			ownedFocus = !!inputs.root?.contains(document.activeElement);
			if (!ownedFocus) navigationIndex = -1;
		};
		document.addEventListener("focusin", track);
		return () => document.removeEventListener("focusin", track);
	});
	onDestroy(() => {
		for (const stop of pending) stop();
	});
	let lastFile: TodoFile | undefined;
	let lastWorkspace = "";
	let lastItems: readonly TodoItem[] | undefined;
	let focusedTodo: TodoItem | undefined;

	async function focus(index: number) {
		const workspace = inputs.workspaceId;
		const todo = inputs.items[index];
		if (!todo) {
			inputs.fallback?.focus();
			return;
		}
		navigationIndex = inputs.items.indexOf(todo);
		focusedTodo = todo;
		inputs.reveal(todo);
		await tick();
		if (workspace !== inputs.workspaceId) return;
		inputs.root?.querySelector<HTMLButtonElement>(`[data-row-navigation="${index}"]`)?.focus();
	}
	function remember(todo: TodoItem) {
		navigationIndex = inputs.items.indexOf(todo);
		focusedTodo = todo;
	}
	// Physical-line identity is trustworthy only while its content is unchanged.
	$effect(() => {
		const file = inputs.todoFile;
		const workspace = inputs.workspaceId;
		const items = inputs.items;
		const changedWorkspace = workspace !== lastWorkspace || file.path !== lastFile?.path;
		if (
			lastFile &&
			(file !== lastFile || changedWorkspace || items !== lastItems) &&
			(!recovering || changedWorkspace) &&
			!inputs.dragging
		) {
			const index = changedWorkspace
				? -1
				: items.findIndex(
						(todo) => todo.line_number === focusedTodo?.line_number && todo.raw === focusedTodo?.raw
					);
			const same = index >= 0;
			if (same && ownedFocus) navigationIndex = index;
			if (!same) {
				if (ownedFocus) inputs.fallback?.focus();
				navigationIndex = -1;
				focusedTodo = undefined;
			}
		}
		lastFile = file;
		lastWorkspace = workspace;
		lastItems = items;
	});

	function capture(todo: TodoItem, editing = false, trigger?: HTMLElement | null) {
		const workspace = inputs.workspaceId;
		const position = inputs.items.indexOf(todo);
		const origin = trigger ?? document.activeElement;
		const owned = !!inputs.root?.contains(origin);
		let cancelled = false;
		const moved = (event: FocusEvent) => {
			if (
				event.target !== origin &&
				!(editing && event.target instanceof HTMLElement && event.target.closest('[role="dialog"]'))
			)
				cancelled = true;
		};
		document.addEventListener("focusin", moved);
		const stop = () => document.removeEventListener("focusin", moved);
		pending.add(stop);
		recovering = owned;
		return {
			async restore(uncertain = false, deleted = false) {
				await tick();
				recovering = false;
				stop();
				pending.delete(stop);
				if (!owned || workspace !== inputs.workspaceId) return;
				if (cancelled) return;
				if (uncertain) {
					navigationIndex = -1;
					focusedTodo = undefined;
					inputs.fallback?.focus();
					return;
				}
				const index = deleted
					? -1
					: inputs.items.findIndex((item) => item.line_number === todo.line_number);
				if (index >= 0 && origin instanceof HTMLElement && origin.isConnected) {
					origin.focus();
					return;
				}
				await focus(index < 0 ? Math.min(position, inputs.items.length - 1) : index);
			},
		};
	}
	function keydown(event: KeyboardEvent, todo?: TodoItem) {
		if (
			event.target !== event.currentTarget ||
			inputs.disabled ||
			inputs.dragging ||
			inputs.scope?.available === false ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			event.isComposing
		)
			return;
		const index = todo ? inputs.items.indexOf(todo) : -1;
		let next: number;
		switch (event.key) {
			case rowShortcuts.down.key:
				next = Math.min(index + 1, inputs.items.length - 1);
				break;
			case rowShortcuts.up.key:
				next = index < 0 ? inputs.items.length - 1 : Math.max(0, index - 1);
				break;
			case rowShortcuts.first.key:
				next = 0;
				break;
			case rowShortcuts.last.key:
				next = inputs.items.length - 1;
				break;
			case rowShortcuts.complete.eventKey:
				if (!todo) return;
				event.preventDefault();
				if (!event.repeat) inputs.onToggle(todo);
				return;
			case rowShortcuts.edit.key:
				if (!todo) return;
				event.preventDefault();
				if (!event.repeat) inputs.onEdit?.(todo, event.currentTarget as HTMLButtonElement);
				return;
			default:
				return;
		}
		event.preventDefault();
		void focus(next);
	}
	return {
		get index() {
			return navigationIndex;
		},
		remember,
		keydown,
		capture,
	};
}
