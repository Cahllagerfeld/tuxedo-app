<script lang="ts">
	import { getAppState } from "$lib/app/app-context";
	import BarChart3 from "@lucide/svelte/icons/bar-chart-3";
	import StatCard from "./StatCard.svelte";

	const appState = getAppState();
</script>

<div class="space-y-3">
	<h3
		class="flex items-center gap-2 text-xs font-medium tracking-wider text-muted-foreground uppercase"
	>
		<BarChart3 class="h-3.5 w-3.5" />
		Overview
	</h3>
	<div class="grid grid-cols-2 gap-2">
		<StatCard label="Open" value={appState.todos.counts.open} color="text-foreground" />
		<StatCard
			label="Done"
			value={appState.todos.counts.completed}
			color="text-[var(--completed)]"
		/>
		<StatCard
			label="Priority"
			value={appState.todos.counts.priority}
			color="text-[var(--priority-a)]"
		/>
		<StatCard
			label="Projects"
			value={appState.todos.counts.projects}
			color="text-[var(--priority-a)]"
		/>
	</div>
</div>
