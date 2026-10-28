<script lang="ts">
	import type { ComponentProps } from "svelte";
	import TodoBoard from "./TodoBoard.svelte";
	let props: ComponentProps<typeof TodoBoard> = $props();
</script>

<div class="h-56 w-96">
	<TodoBoard {...props} />
</div>
