<script lang="ts">
	import Search from "@lucide/svelte/icons/search";
	import X from "@lucide/svelte/icons/x";
	import type { TodoFilterState } from "$lib/modules/todo/state/todo-filter.svelte";
	import { Button } from "$lib/shared/ui/button";
	import { Input } from "$lib/shared/ui/input";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import FacetFilter from "./FacetFilter.svelte";
	import PriorityFilter from "./PriorityFilter.svelte";

	let { todoFilter, disabled }: { todoFilter: TodoFilterState; disabled: boolean } = $props();
	let search = $state("");
</script>

<div class="relative mx-2 mt-1 mb-3 min-w-0 shrink-0">
	<Search
		class="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground"
		aria-hidden="true"
	/>
	<Input
		type="search"
		bind:value={search}
		aria-label="Find a filter"
		placeholder="Find a filter…"
		{disabled}
		class="h-9 w-full max-w-full min-w-0 pr-8 pl-8 text-xs [&::-webkit-search-cancel-button]:appearance-none"
	/>
	{#if search}<Button
			variant="ghost"
			size="icon-xs"
			class="absolute top-1.5 right-1"
			aria-label="Clear filter search"
			onclick={() => (search = "")}><X class="size-3" aria-hidden="true" /></Button
		>{/if}
</div>
<ScrollArea
	class="min-h-0 w-full min-w-0 flex-1 [&_[data-scroll-area-content]]:max-w-full [&_[data-scroll-area-content]]:min-w-0"
	aria-label="Sidebar filters"
>
	<div class="min-w-0 pb-3">
		<FacetFilter
			label="Projects"
			values={todoFilter.availableFacets.projects}
			counts={todoFilter.availableFacets.counts.projects}
			selected={todoFilter.selectedProject}
			{search}
			{disabled}
			onSelect={todoFilter.toggleProject}
		/>
		<FacetFilter
			label="Contexts"
			values={todoFilter.availableFacets.contexts}
			counts={todoFilter.availableFacets.counts.contexts}
			selected={todoFilter.selectedContext}
			{search}
			{disabled}
			onSelect={todoFilter.toggleContext}
		/>
		<PriorityFilter
			values={todoFilter.availableFacets.priorities}
			counts={todoFilter.availableFacets.counts.priorities}
			selected={todoFilter.selectedPriority}
			{search}
			{disabled}
			completed={todoFilter.status === "completed"}
			onSelect={todoFilter.togglePriority}
		/>
	</div>
</ScrollArea>
