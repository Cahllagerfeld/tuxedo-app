<script lang="ts">
	import { getAppState } from "$lib/app/app-context";
	import { openWorkspaceDirectory } from "$lib/modules/workspace/state/workspace-actions";
	import Button from "@/shared/ui/button/button.svelte";
	import FolderOpen from "@lucide/svelte/icons/folder-open";

	const appState = getAppState();
</script>

<header class="h-12 bg-card border-b border-border flex items-center justify-between px-4">
	<div class="min-w-0">
		<p class="truncate font-mono text-sm">
			{appState.workspace.root ?? "No workspace selected"}
		</p>
	</div>
	<Button
		variant="outline"
		type="button"
		onclick={() => openWorkspaceDirectory(appState.workspace)}
		disabled={appState.workspace.isLoading}
	>
		<FolderOpen class="h-4 w-4" />
		{appState.workspace.isLoading ? "Opening..." : "Open Workspace"}
	</Button>
</header>
