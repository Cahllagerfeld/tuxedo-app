import type { TodoItem } from "$lib/modules/todo/domain/todo";
import type { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";

const todoKey = (todo: TodoItem) => `${todo.line_number}\0${todo.raw}`;

type Inputs = {
	readonly getWorkspace: () => ElectronWorkspaceSessionState;
	readonly getMatchingItems: () => readonly TodoItem[];
	readonly getFilterSignature: () => string;
	readonly getWorkspaceKey: () => string;
	readonly onCleared?: (reason: "external" | "filter") => void;
};

export function createTodoBulkSelection(inputs: Inputs) {
	let active = $state(false);
	let keys = $state.raw<Set<string>>(new Set());
	let lastFilterSignature = "";
	let lastWorkspaceKey = "";
	let lastFileSignature = "";

	function clear(notify = false, reason: "external" | "filter" = "filter") {
		if (notify && keys.size) inputs.onCleared?.(reason);
		keys = new Set();
	}

	function enter() {
		active = true;
		clear();
	}

	function exit() {
		active = false;
		clear();
	}

	function toggle(todo: TodoItem) {
		const key = todoKey(todo);
		const next = new Set(keys);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		keys = next;
	}

	function selectAll() {
		keys = new Set(inputs.getMatchingItems().map(todoKey));
	}

	const selectedItems = $derived.by(() => {
		if (!active) return [];
		const selected = keys;
		return inputs.getMatchingItems().filter((todo) => selected.has(todoKey(todo)));
	});

	const selectedOpenCount = $derived(selectedItems.filter((todo) => !todo.completed).length);

	$effect(() => {
		const signature = inputs.getFilterSignature();
		const workspaceKey = inputs.getWorkspaceKey();
		if (!active) {
			lastFilterSignature = signature;
			lastWorkspaceKey = workspaceKey;
			return;
		}
		if (workspaceKey !== lastWorkspaceKey) {
			exit();
			return;
		}
		if (signature !== lastFilterSignature) clear(true);
		lastFilterSignature = signature;
		lastWorkspaceKey = workspaceKey;
	});

	$effect(() => {
		const workspace = inputs.getWorkspace();
		const file = workspace.todoFile;
		const signature = file
			? JSON.stringify(file.items.map((item) => [item.line_number, item.raw]))
			: "";
		if (
			active &&
			!workspace.isOperating &&
			lastFileSignature &&
			signature !== lastFileSignature &&
			keys.size
		)
			clear(true, "external");
		lastFileSignature = signature;
	});

	return {
		get active() {
			return active;
		},
		get count() {
			return selectedItems.length;
		},
		get selectedItems() {
			return selectedItems;
		},
		get selectedOpenCount() {
			return selectedOpenCount;
		},
		enter,
		exit,
		toggle,
		selectAll,
		clear: () => clear(),
		isSelected(todo: TodoItem) {
			return keys.has(todoKey(todo));
		},
	};
}
