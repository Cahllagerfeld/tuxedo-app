<script lang="ts">
	import Overview from "./Overview.svelte";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import PriorityFilter from "./PriorityFilter.svelte";
</script>

<aside class="flex h-full shrink-0 flex-col overflow-hidden bg-sidebar">
	<ScrollArea class="min-h-0 flex-1">
		<div class="flex flex-col p-4 gap-5">
			<Overview />
			<PriorityFilter />
		</div>
	</ScrollArea>
</aside>
