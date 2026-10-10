<script lang="ts">
	import type { TodoFileSummary } from "$lib/modules/todo/domain/todo-file-summary";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import Circle from "@lucide/svelte/icons/circle";
	import CircleCheck from "@lucide/svelte/icons/circle-check";
	import type { TodoFilterState } from "$lib/modules/todo/state/todo-filter.svelte";
	let {
		todoSummary,
		todoFilter,
		disabled = false,
	}: { todoSummary: TodoFileSummary; todoFilter: TodoFilterState; disabled?: boolean } = $props();
</script>

<Sidebar.Group>
	<Sidebar.GroupLabel>Overview</Sidebar.GroupLabel>
	<Sidebar.GroupContent>
		<ul class="space-y-0.5">
			<li>
				<button
					type="button"
					class="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-sidebar-accent"
					class:bg-sidebar-accent={todoFilter.status === "open"}
					aria-pressed={todoFilter.status === "open"}
					{disabled}
					onclick={() => todoFilter.setStatus("open")}
				>
					<Circle class="size-4 text-muted-foreground" aria-hidden="true" />
					<span>Open</span><span class="ml-auto text-xs text-muted-foreground tabular-nums"
						>{todoSummary.counts.open}</span
					>
				</button>
			</li>
			<li>
				<button
					type="button"
					class="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-sidebar-accent"
					class:bg-sidebar-accent={todoFilter.status === "completed"}
					aria-pressed={todoFilter.status === "completed"}
					{disabled}
					onclick={() => todoFilter.setStatus("completed")}
				>
					<CircleCheck class="size-4 text-muted-foreground" aria-hidden="true" />
					<span>Completed</span><span class="ml-auto text-xs text-muted-foreground tabular-nums"
						>{todoSummary.counts.completed}</span
					>
				</button>
			</li>
		</ul>
	</Sidebar.GroupContent>
</Sidebar.Group>
