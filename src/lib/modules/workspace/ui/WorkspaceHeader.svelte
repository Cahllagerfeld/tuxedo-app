<script lang="ts">
	import { getAppState } from "$lib/app/app-context";
	import Button from "@/shared/ui/button/button.svelte";
	import FolderOpen from "@lucide/svelte/icons/folder-open";

	const appState = getAppState();
</script>

<header class="h-12 bg-card border-b border-border flex items-center justify-between px-4">
	<div class="min-w-0 flex items-center gap-3">
		<span
			class="size-3 shrink-0 rounded-full"
			style:background-color={appState.workspace.activeWorkspace?.color ?? "#6b7280"}
		></span>
		<div class="min-w-0">
			<p class="truncate text-sm font-semibold">
				{appState.workspace.activeWorkspace?.name ?? "No workspace selected"}
			</p>
			<p class="truncate font-mono text-xs text-muted-foreground">
				{appState.workspace.activeWorkspace?.root ?? "Choose a directory to load todo.txt"}
			</p>
		</div>
	</div>
	<div class="shrink-0">
		<Button
			variant="outline"
			type="button"
			onclick={appState.workspace.openDirectory}
			disabled={appState.workspace.isLoading}
		>
			<FolderOpen class="h-4 w-4" />
			{appState.workspace.isLoading ? "Opening..." : "Open Workspace"}
		</Button>
	</div>
</header>
