<script lang="ts">
	import { getAppState } from "$lib/app/app-context";

	const appState = getAppState();
</script>

<header class="h-12 bg-card border-b border-border flex items-center justify-between px-4">
	<div class="min-w-0">
		<p class="truncate font-mono text-sm">
			{appState.workspace.activeWorkspace?.name ?? "No workspace selected"}
		</p>
	</div>
</header>
