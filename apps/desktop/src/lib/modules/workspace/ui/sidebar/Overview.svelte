<script lang="ts">
	import type { TodoFileSummary } from "#lib/modules/todo/domain/todo-file-summary.js";
	import * as Sidebar from "#lib/shared/ui/sidebar/index.js";
	import { Button } from "#lib/shared/ui/button/index.js";
	import Circle from "@lucide/svelte/icons/circle";
	import CircleCheck from "@lucide/svelte/icons/circle-check";
	import List from "@lucide/svelte/icons/list";
	import type { TodoFilterState } from "#lib/modules/todo/state/todo-filter.svelte.js";
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
					<Button
						variant="ghost"
						size="sm"
						class="h-8 w-full justify-start gap-2 px-2 text-left font-normal hover:bg-sidebar-accent aria-pressed:bg-sidebar-accent"
						aria-pressed={todoFilter.status === view.status}
						{disabled}
						onclick={() => todoFilter.setStatus(view.status)}
					>
						<view.icon class="size-4 text-muted-foreground" aria-hidden="true" />
						<span>{view.label}</span><span
							class="ml-auto text-xs text-muted-foreground tabular-nums"
							>{todoSummary.counts[view.count]}</span
						>
					</Button>
				</li>
			{/each}
		</ul>
	</Sidebar.GroupContent>
</Sidebar.Group>
