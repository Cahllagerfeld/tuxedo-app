<script lang="ts">
	import type { ComponentProps } from "svelte";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import TodoList from "./TodoList.svelte";
	let props: Omit<ComponentProps<typeof TodoList>, "scrollElement"> = $props();
	let viewport = $state<HTMLElement | null>(null);
</script>

<ScrollArea bind:viewportRef={viewport} class="h-96 w-full">
	<TodoList {...props} scrollElement={viewport} />
</ScrollArea>
