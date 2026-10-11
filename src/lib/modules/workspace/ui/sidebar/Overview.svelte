<script lang="ts">
	import type { TodoFileSummary } from "$lib/modules/todo/domain/todo-file-summary";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import Circle from "@lucide/svelte/icons/circle";
	import CircleCheck from "@lucide/svelte/icons/circle-check";
	import List from "@lucide/svelte/icons/list";
	import type { TodoFilterState } from "$lib/modules/todo/state/todo-filter.svelte";
	let {
		todoSummary,
		todoFilter,
		disabled = false,
	}: { todoSummary: TodoFileSummary; todoFilter: TodoFilterState; disabled?: boolean } = $props();

	const views = [
		{ status: "all", label: "All", icon: List, count: "total" },
		{ status: "open", label: "Open", icon: Circle, count: "open" },
		{ status: "completed", label: "Completed", icon: CircleCheck, count: "completed" },
	] as const;
</script>

<Sidebar.Group>
	<Sidebar.GroupLabel>Overview</Sidebar.GroupLabel>
	<Sidebar.GroupContent>
		<ul class="space-y-0.5">
			{#each views as view (view.status)}
				<li>
					<Sidebar.MenuButton
						class="data-active:font-normal"
						isActive={todoFilter.status === view.status}
						aria-pressed={todoFilter.status === view.status}
						{disabled}
						onclick={() => todoFilter.setStatus(view.status)}
					>
						<view.icon class="size-4 text-muted-foreground" aria-hidden="true" />
						<span>{view.label}</span><span
							class="ml-auto text-xs text-muted-foreground tabular-nums"
							>{todoSummary.counts[view.count]}</span
						>
					</Sidebar.MenuButton>
				</li>
			{/each}
		</ul>
	</Sidebar.GroupContent>
</Sidebar.Group>
