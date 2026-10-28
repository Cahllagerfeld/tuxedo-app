<script lang="ts">
	import type { ComponentProps } from "svelte";
	import type { TodoItem } from "../domain/todo";
	import TodoBoard from "./TodoBoard.svelte";
	let props: ComponentProps<typeof TodoBoard> = $props();
	let board = $state<ReturnType<typeof TodoBoard>>();
	export const focusTodo = (todo: TodoItem) => board?.focusTodo(todo);
</script>

<div class="h-56 w-96">
	<TodoBoard bind:this={board} {...props} />
</div>
