<script lang="ts">
	import type { TodoItem } from "@/todo";
	import { cn } from "@/utils";
	import { Checkbox } from "../ui/checkbox";

	type TodoItemProps = {
		todo: TodoItem;
	};

	let { todo }: TodoItemProps = $props();
</script>

<div
	class={cn(
		"group flex items-center gap-3 px-4 hover:bg-secondary/50 py-2.5 rounded-lg transition-all",
		todo.completed && "opacity-60"
		// random > 50 && "bg-accent ring-1 ring-primary/50"
	)}
>
	<Checkbox class="rounded-full size-5 hover:cursor-pointer" checked={todo.completed} />
	<span class:line-through={todo.completed}>{todo.description}</span>
</div>
