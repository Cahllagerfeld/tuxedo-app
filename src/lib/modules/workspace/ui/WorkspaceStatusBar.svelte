<script lang="ts">
	import { getAppState } from "$lib/app/app-context";

	const appState = getAppState();
</script>

<footer
	class="h-8 bg-card border-t border-border flex items-center justify-between gap-4 px-4 text-xs"
>
	<div class="min-w-0 truncate">
		{#if appState.workspace.isLoading}
			Loading workspace...
		{:else if appState.workspace.activeWorkspace}
			<span class="font-medium">{appState.workspace.activeWorkspace.name}</span>
			<span class="text-muted-foreground"> · {appState.workspace.activeWorkspace.root}</span>
		{:else}
			<span class="text-muted-foreground">No workspace selected</span>
		{/if}
	</div>
	{#if appState.workspace.todoPath}
		<div class="hidden min-w-0 truncate font-mono text-muted-foreground sm:block">
			{appState.workspace.todoPath}
		</div>
	{/if}
</footer>
