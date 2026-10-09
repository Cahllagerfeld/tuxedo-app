<script lang="ts">
	import type { TodoFileSummary } from "$lib/modules/todo/domain/todo-file-summary";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import { cn } from "cn";
	let { todoSummary }: { todoSummary: TodoFileSummary } = $props();

	function getPriorityClass(priority: string) {
		if (priority === "A") return "bg-[var(--priority-a-muted)] text-[var(--priority-a)]";
		if (priority === "B") return "bg-[var(--priority-b-muted)] text-[var(--priority-b)]";
		if (priority === "C") return "bg-[var(--priority-c-muted)] text-[var(--priority-c)]";
		return "bg-secondary text-muted-foreground";
	}
</script>

{#if todoSummary.facets.priorities.length > 0}
	<Sidebar.Group>
		<Sidebar.GroupLabel>Priorities</Sidebar.GroupLabel>
		<Sidebar.GroupContent>
			<ul class="space-y-0.5">
				{#each todoSummary.facets.priorities as priority (priority)}
					<li class="flex h-8 items-center gap-2 px-2 text-sm">
						<span
							class={cn(
								"flex size-5 shrink-0 items-center justify-center rounded font-mono text-[11px]",
								getPriorityClass(priority)
							)}>{priority}</span
						>
						<span>Priority {priority}</span>
					</li>
				{/each}
			</ul>
		</Sidebar.GroupContent>
	</Sidebar.Group>
{/if}
