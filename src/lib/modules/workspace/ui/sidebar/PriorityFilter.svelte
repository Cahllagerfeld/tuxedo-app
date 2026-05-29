<script lang="ts">
	import { getAppState } from "$lib/app/app-context";
	import * as Collapsible from "$lib/shared/ui/collapsible";
	import { cn } from "@/shared/utils";
	import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
	import Star from "@lucide/svelte/icons/star";

	const appState = getAppState();
	const visibleLimit = 3;

	let expanded = $state(false);

	const priorities = $derived(
		[...appState.todos.availablePriorities].sort((left, right) => left.localeCompare(right))
	);
	const visiblePriorities = $derived(priorities.slice(0, visibleLimit));
	const collapsedPriorities = $derived(priorities.slice(visibleLimit));
	const hasCollapsedPriorities = $derived(collapsedPriorities.length > 0);

	function getPriorityClass(priority: string) {
		if (priority === "A") {
			return "bg-[var(--priority-a)]/20 text-[var(--priority-a)]";
		}

		if (priority === "B") {
			return "bg-[var(--priority-b)]/20 text-[var(--priority-b)]";
		}

		if (priority === "C") {
			return "bg-[var(--priority-c)]/20 text-[var(--priority-c)]";
		}

		return "bg-secondary/50 text-muted-foreground";
	}
</script>

{#if priorities.length > 0}
	<Collapsible.Root bind:open={expanded} class="space-y-2">
		<div class="flex items-center justify-between gap-2">
			<h3
				class="flex items-center gap-2 text-xs font-medium tracking-wider text-muted-foreground uppercase"
			>
				<Star class="h-3.5 w-3.5" />
				Priority
			</h3>
			{#if hasCollapsedPriorities}
				<Collapsible.Trigger
					class="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
				>
					<ChevronsUpDown class="h-3.5 w-3.5" />
					<span class="sr-only">{expanded ? "Hide priorities" : "Show all priorities"}</span>
				</Collapsible.Trigger>
			{/if}
		</div>

		<div class="grid grid-cols-3 gap-1">
			{#each visiblePriorities as priority (priority)}
				<button
					type="button"
					tabindex="-1"
					class={cn(
						"w-full cursor-default rounded py-1.5 font-mono text-xs",
						getPriorityClass(priority)
					)}
				>
					({priority})
				</button>
			{/each}
		</div>

		{#if hasCollapsedPriorities}
			<Collapsible.Content>
				<div class="grid grid-cols-3 gap-1">
					{#each collapsedPriorities as priority (priority)}
						<button
							type="button"
							tabindex="-1"
							class={cn(
								"w-full cursor-default rounded py-1.5 font-mono text-xs",
								getPriorityClass(priority)
							)}
						>
							({priority})
						</button>
					{/each}
				</div>
			</Collapsible.Content>
		{/if}
	</Collapsible.Root>
{/if}
