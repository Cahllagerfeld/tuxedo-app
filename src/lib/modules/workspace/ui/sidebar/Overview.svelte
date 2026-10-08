<script lang="ts">
	import type { TodoFileSummary } from "$lib/modules/todo/domain/todo-file-summary";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import Circle from "@lucide/svelte/icons/circle";
	import CircleCheck from "@lucide/svelte/icons/circle-check";
	let { todoSummary }: { todoSummary: TodoFileSummary } = $props();
</script>

<Sidebar.Group>
	<Sidebar.GroupLabel>Overview</Sidebar.GroupLabel>
	<Sidebar.GroupContent>
		<ul class="space-y-0.5">
			<li class="flex h-8 items-center gap-2 rounded-md bg-sidebar-accent px-2 text-sm">
				<Circle class="size-4 text-muted-foreground" aria-hidden="true" />
				<span>Open</span><span class="ml-auto text-xs text-muted-foreground tabular-nums"
					>{todoSummary.counts.open}</span
				>
			</li>
			<li class="flex h-8 items-center gap-2 rounded-md px-2 text-sm">
				<CircleCheck class="size-4 text-muted-foreground" aria-hidden="true" />
				<span>Completed</span><span class="ml-auto text-xs text-muted-foreground tabular-nums"
					>{todoSummary.counts.completed}</span
				>
			</li>
		</ul>
	</Sidebar.GroupContent>
</Sidebar.Group>
