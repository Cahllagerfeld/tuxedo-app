<script lang="ts">
	import X from "@lucide/svelte/icons/x";
	import { Button } from "$lib/shared/ui/button";
	import type { TodoFilterState } from "../state/todo-filter.svelte";

	let { todoFilter, disabled }: { todoFilter: TodoFilterState; disabled: boolean } = $props();
	const selections = $derived(
		[
			{
				label: "Project",
				value: todoFilter.selectedProject,
				prefix: "+",
				clear: todoFilter.clearProject,
			},
			{
				label: "Context",
				value: todoFilter.selectedContext,
				prefix: "@",
				clear: todoFilter.clearContext,
			},
			{
				label: "Priority",
				value: todoFilter.activePriority,
				prefix: "",
				clear: todoFilter.clearPriority,
			},
		].filter((selection) => selection.value !== null)
	);
</script>

{#if selections.length}
	<div
		class="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b px-5 py-2.5"
		aria-label="Active filters"
	>
		<span class="text-xs text-muted-foreground">Matching all</span>
		{#each selections as selection (selection.label)}
			<Button
				variant="secondary"
				size="xs"
				class="max-w-full min-w-0 gap-1"
				{disabled}
				aria-label={`Clear ${selection.label} ${selection.value}`}
				title={`${selection.prefix}${selection.value}`}
				onclick={selection.clear}
				><span class="min-w-0 truncate">{selection.prefix}{selection.value}</span><X
					class="size-3 shrink-0"
					aria-hidden="true"
				/></Button
			>
		{/each}
		<Button
			variant="ghost"
			size="xs"
			class="ml-auto shrink-0 text-muted-foreground"
			{disabled}
			onclick={todoFilter.clear}>Clear filters</Button
		>
	</div>
{/if}
