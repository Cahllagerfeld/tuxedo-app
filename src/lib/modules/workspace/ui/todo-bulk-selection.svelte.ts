import type { TodoItem } from "$lib/modules/todo/domain/todo";
import type { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";

const todoKey = (todo: TodoItem) => `${todo.line_number}\0${todo.raw}`;

function cell<T>(initial: T) {
	let value = $state.raw(initial);
	return {
		get value() {
			return value;
		},
		set value(next: T) {
			value = next;
		},
	};
}

type Inputs = {
	readonly getWorkspace: () => ElectronWorkspaceSessionState;
	readonly getMatchingItems: () => readonly TodoItem[];
	readonly getFilterSignature: () => string;
};

export function createTodoBulkSelection(inputs: Inputs) {
	const workspaceKey = $derived(
		`${inputs.getWorkspace().activeWorkspace?.id ?? ""}:${inputs.getWorkspace().todoFile?.path ?? ""}`
	);
	const fileSignature = $derived(JSON.stringify(inputs.getWorkspace().todoFile));
	const filterSignature = $derived(inputs.getFilterSignature());
	const mode = $derived.by(() => {
		workspaceKey;
		return cell(false);
	});
	const selection = $derived.by(() => {
		workspaceKey;
		fileSignature;
		filterSignature;
		return cell(new Set<string>());
	});
	const selectedItems = $derived(
		mode.value ? inputs.getMatchingItems().filter((todo) => selection.value.has(todoKey(todo))) : []
	);
	const selectedOpenCount = $derived(selectedItems.filter((todo) => !todo.completed).length);
	function clear() {
		selection.value = new Set();
	}
	function exit() {
		if (inputs.getWorkspace().isOperating) return;
		mode.value = false;
		clear();
	}
	return {
		get active() {
			return mode.value;
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
		get selectedCompletedCount() {
			return selectedItems.length - selectedOpenCount;
		},
		// The UI uses these identities only to announce invalidation to the user.
		get context() {
			return { workspaceKey, fileSignature, filterSignature, selection };
		},
		enter() {
			if (inputs.getWorkspace().isOperating) return;
			mode.value = true;
			clear();
		},
		exit,
		toggle(todo: TodoItem) {
			if (inputs.getWorkspace().isOperating) return;
			const next = new Set(selection.value);
			const key = todoKey(todo);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			selection.value = next;
		},
		selectAll() {
			if (!inputs.getWorkspace().isOperating)
				selection.value = new Set(inputs.getMatchingItems().map(todoKey));
		},
		clear,
		isSelected(todo: TodoItem) {
			return selection.value.has(todoKey(todo));
		},
	};
}
