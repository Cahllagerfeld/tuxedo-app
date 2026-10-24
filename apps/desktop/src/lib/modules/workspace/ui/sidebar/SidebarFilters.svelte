<script lang="ts">
	import Search from "@lucide/svelte/icons/search";
	import X from "@lucide/svelte/icons/x";
	import type { TodoFilterState } from "#lib/modules/todo/state/todo-filter.svelte.js";
	import { Button } from "#lib/shared/ui/button/index.js";
	import { Input } from "#lib/shared/ui/input/index.js";
	import { ScrollArea } from "#lib/shared/ui/scroll-area/index.js";
	import FacetFilter from "./FacetFilter.svelte";
	import PriorityFilter from "./PriorityFilter.svelte";
	import { dueLabels, type TodoDueCategory } from "#lib/modules/todo/domain/todo-due.js";
	import FilterSection from "./FilterSection.svelte";
	const dueCategories: TodoDueCategory[] = ["overdue", "today", "upcoming", "none", "invalid"];

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
		<FilterSection label="Due date" {search}>
			{#each dueCategories.filter((category) => (category !== "invalid" || (todoFilter.invalidDueCount > 0 && todoFilter.status !== "completed")) && dueLabels[category]
						.toLocaleLowerCase()
						.includes(search.toLocaleLowerCase())) as category (category)}
				<Button
					variant="ghost"
					size="sm"
					class="h-8 w-full justify-start px-2 font-normal aria-pressed:bg-sidebar-accent"
					aria-pressed={todoFilter.selectedDue === category}
					disabled={disabled || todoFilter.status === "completed"}
					onclick={() => todoFilter.toggleDue(category)}
					aria-label={dueLabels[category]}
					>{dueLabels[category]}{#if category === "invalid"}<span
							class="ml-auto shrink-0 text-xs text-muted-foreground"
							>{todoFilter.invalidDueCount}</span
						>{/if}</Button
				>
			{/each}
		</FilterSection>
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
			selected={todoFilter.selectedPriority}
			{search}
			{disabled}
			completed={todoFilter.status === "completed"}
			onSelect={todoFilter.togglePriority}
		/>
	</div>
</ScrollArea>
