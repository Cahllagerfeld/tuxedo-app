<script lang="ts">
	import ScrollArea from "@/components/ui/scroll-area/scroll-area.svelte";
	import "./layout.css";
	let { children } = $props();
</script>

<div class="h-dvh font-medium antialiased overflow-x-hidden">
	<ScrollArea class="h-full">
		{@render children()}
	</ScrollArea>
</div>
