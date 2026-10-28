<script lang="ts">
	import { untrack } from "svelte";
	import type { TodoItem } from "../domain/todo";
	import TodoBoard from "./TodoBoard.svelte";

	let {
		initialItems,
		complete,
	}: {
		initialItems: readonly TodoItem[];
		complete: (todo: TodoItem) => Promise<"applied" | "conflict">;
	} = $props();
	let items = $state.raw(untrack(() => initialItems));
	let board = $state<ReturnType<typeof TodoBoard>>();

	async function toggle(todo: TodoItem) {
		const recovery = board?.captureFocus(todo);
		const result = await complete(todo);
		if (result === "applied") {
			items = items.map((item) =>
				item.line_number === todo.line_number
					? { ...item, completed: !item.completed, raw: `x ${item.raw}` }
					: item
			);
		}
		await recovery?.restore(result === "conflict");
	}
</script>

<button type="button">Other control</button>
<div class="h-56 w-96">
	<TodoBoard
		bind:this={board}
		{items}
		today="2026-10-28"
		disabled={false}
		onOpen={() => {}}
		onToggleComplete={(todo) => void toggle(todo)}
	/>
</div>
