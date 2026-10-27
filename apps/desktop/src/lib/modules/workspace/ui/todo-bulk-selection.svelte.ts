import { untrack } from "svelte";
import type { TodoItem } from "#lib/modules/todo/domain/todo.js";
import type { WorkspaceCommands } from "../state/workspace-commands.svelte";
import type { WorkspaceView } from "../state/workspace-view";
import type { WorkspaceSessionActionResult } from "../state/workspace-session-types";

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
	readonly getWorkspace: () => Pick<WorkspaceCommands, "isOperating" | "writesBlocked">;
	readonly getData: () => Pick<WorkspaceView, "activeWorkspace" | "todoFile">;
	readonly getMatchingItems: () => readonly TodoItem[];
	readonly getFilterSignature: () => string;
	readonly onInvalidated: (message: string) => void;
};

type Change = (items: readonly TodoItem[]) => Promise<WorkspaceSessionActionResult>;

export function createTodoBulkSelection(inputs: Inputs) {
	const workspaceKey = $derived(
		`${inputs.getData().activeWorkspace?.id ?? ""}:${inputs.getData().todoFile?.path ?? ""}`
	);
	const fileSignature = $derived(JSON.stringify(inputs.getData().todoFile));
	const filterSignature = $derived(inputs.getFilterSignature());
	const matchingSignature = $derived(JSON.stringify(inputs.getMatchingItems().map(todoKey).sort()));
	const scope = $derived(Symbol(workspaceKey));
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
	let confirmation = $state.raw<{
		scope: symbol;
		selection: Set<string>;
		items: readonly TodoItem[];
	} | null>(null);
	let deleting = $state(false);
	const context = $derived({
		scope,
		fileSignature,
		filterSignature,
		matchingSignature,
		selection: selection.value,
	});
	let previousSelection: typeof context | undefined;
	// Loader updates and local-date events can retire selected items; remember that history before rendering or announcing it.
	$effect.pre(() => {
		const current = { ...context };
		const visible = new Set(inputs.getMatchingItems().map(todoKey));
		const blocked = inputs.getWorkspace().writesBlocked;
		const active = mode.value;
		untrack(() => {
			const retained = new Set([...current.selection].filter((key) => visible.has(key)));
			if (retained.size !== current.selection.size) {
				selection.value = retained;
				current.selection = retained;
			}
			if (blocked) return;
			if (
				previousSelection?.scope === current.scope &&
				previousSelection.selection !== current.selection &&
				previousSelection.selection.size &&
				active
			) {
				const message =
					previousSelection.fileSignature !== fileSignature
						? "Selection cleared because the Todo file changed."
						: previousSelection.filterSignature !== filterSignature
							? "Selection cleared because filters changed."
							: previousSelection.matchingSignature !== matchingSignature
								? "Selection updated because some Todo items are no longer shown."
								: null;
				if (message) inputs.onInvalidated(message);
			}
			previousSelection = current;
		});
	});
	const deletionItems = $derived(
		confirmation?.scope === scope &&
			mode.value &&
			(deleting ||
				inputs.getWorkspace().writesBlocked ||
				confirmation.selection === selection.value)
			? confirmation.items
			: null
	);
	function clear() {
		previousSelection = undefined;
		selection.value = new Set();
		confirmation = null;
	}
	async function change(
		items: readonly TodoItem[] | null,
		action: Change
	): Promise<WorkspaceSessionActionResult> {
		if (inputs.getWorkspace().writesBlocked || !items?.length)
			return { status: "rejected", message: "Select Todo items in the current Workspace first." };
		previousSelection = undefined;
		// Let the caller prepare focus and announce the outcome before closing the confirmation.
		const result = await action([...items]);
		if (result.status !== "rejected") clear();
		return result;
	}
	function exit() {
		if (inputs.getWorkspace().isOperating) return;
		mode.value = false;
		clear();
	}
	return {
		get scope() {
			return scope;
		},
		get deletionItems() {
			return deletionItems;
		},
		get deleting() {
			return deleting;
		},
		openDeletion() {
			if (!inputs.getWorkspace().writesBlocked && selectedItems.length)
				confirmation = { scope, selection: selection.value, items: [...selectedItems] };
		},
		cancelDeletion() {
			if (!inputs.getWorkspace().isOperating && !deleting) confirmation = null;
		},
		changeSelected: (action: Change) => change(selectedItems, action),
		async deleteConfirmed(action: Change) {
			if (deleting) return { status: "rejected" as const, message: "Deletion is already running." };
			const items = deletionItems;
			deleting = true;
			try {
				return await change(items, action);
			} finally {
				deleting = false;
			}
		},
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
