import { expect, test } from "vitest";
import { tick } from "svelte";
import type { TodoItem } from "@tuxedo/contracts/todo";
import { createTodoBulkSelection } from "./todo-bulk-selection.svelte";

const first: TodoItem = {
	line_number: 1,
	raw: "First",
	description: "First",
	completed: false,
	priority: null,
	creation_date: null,
	completion_date: null,
	projects: [],
	contexts: [],
	metadata: {},
	edit: { description: "First", metadata: [] },
};
const second: TodoItem = { ...first, line_number: 2, raw: "Second", description: "Second" };

test("visibility arrivals retain confirmation, while hidden selections are pruned permanently", async () => {
	let visible = $state.raw<readonly TodoItem[]>([first]);
	const notices: string[] = [];
	let selection!: ReturnType<typeof createTodoBulkSelection>;
	const dispose = $effect.root(() => {
		selection = createTodoBulkSelection({
			getWorkspace: () => ({ isOperating: false, writesBlocked: false }),
			getData: () => ({
				activeWorkspace: {
					id: "work",
					name: "Work",
					color: "blue",
					todo_path: "/work.txt",
					created_at: "2026-10-24T00:00:00Z",
				},
				todoFile: { path: "/work.txt", items: [first, second], skipped: [] },
			}),
			getMatchingItems: () => visible,
			getFilterSignature: () => "",
			onInvalidated: (message) => notices.push(message),
		});
	});
	try {
		selection.enter();
		selection.selectAll();
		selection.openDeletion();
		await tick();
		visible = [first, second];
		await tick();
		expect(selection.selectedItems).toEqual([first]);
		expect(selection.deletionItems).toEqual([first]);
		expect(notices).toEqual([]);
		selection.selectAll();
		selection.openDeletion();
		await tick();
		visible = [first];
		await tick();
		expect(selection.deletionItems).toBeNull();
		expect(notices).toEqual(["Selection updated because some Todo items are no longer shown."]);
		visible = [first, second];
		await tick();
		expect(selection.selectedItems).toEqual([first]);
	} finally {
		dispose();
	}
});
