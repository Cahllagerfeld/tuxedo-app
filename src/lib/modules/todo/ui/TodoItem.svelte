<script lang="ts">
	import type { TodoItem } from "@/modules/todo/domain/todo";
	import { getAppState } from "$lib/app/app-context";
	import { toggleTodoItem } from "$lib/modules/workspace/state/workspace-actions";
	import { cn } from "@/shared/utils";
	import { Checkbox } from "$lib/shared/ui/checkbox";

	type TodoItemProps = {
		todo: TodoItem;
	};

	let { todo }: TodoItemProps = $props();

	const appState = getAppState();
	let isToggling = $state(false);

	async function handleCheckedChange() {
		if (isToggling) {
			return;
		}

		isToggling = true;

		try {
			await toggleTodoItem(appState.workspace, todo.line_number, todo.raw);
		} finally {
			isToggling = false;
		}
	}
</script>

<div
	class={cn(
		"group flex items-center gap-3 px-4 hover:bg-secondary/50 py-2.5 rounded-lg transition-all",
		todo.completed && "opacity-60"
	)}
>
	<Checkbox
		class="rounded-full size-5 hover:cursor-pointer"
		checked={todo.completed}
		disabled={isToggling}
		aria-label={todo.completed ? "Mark task incomplete" : "Mark task complete"}
		onCheckedChange={handleCheckedChange}
	/>
	<span class:line-through={todo.completed}>{todo.description}</span>
</div>
