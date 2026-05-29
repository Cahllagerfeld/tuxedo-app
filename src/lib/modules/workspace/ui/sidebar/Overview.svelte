<script lang="ts">
	import { getAppState } from "$lib/app/app-context";
	import BarChart3 from "@lucide/svelte/icons/bar-chart-3";
	import StatCard from "./StatCard.svelte";

	const appState = getAppState();
</script>

<div class="space-y-3">
	<h3
		class="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2"
	>
		<BarChart3 class="w-3.5 h-3.5" />
		Overview
	</h3>
	<div class="grid grid-cols-2 gap-2">
		<StatCard label="Open" value={appState.todos.openCount} color="text-foreground" />
		<StatCard label="Done" value={appState.todos.completedCount} color="text-[var(--completed)]" />
		<StatCard
			label="Priority"
			value={appState.todos.priorityCount}
			color="text-[var(--priority-a)]"
		/>
		<StatCard
			label="Projects"
			value={appState.todos.projectCount}
			color="text-[var(--priority-a)]"
		/>
	</div>
</div>
