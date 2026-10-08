<script lang="ts">
	import type { Workspace } from "$lib/modules/workspace/domain/workspace";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import { Separator } from "$lib/shared/ui/separator";
	let { activeWorkspace }: { activeWorkspace: Workspace | null } = $props();
</script>

<header class="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
	<Sidebar.Trigger />
	<Separator orientation="vertical" class="h-4" />
	<div class="flex min-w-0 items-center gap-2 text-sm">
		<span class="truncate font-medium">{activeWorkspace?.name ?? "Tuxedo"}</span>
		{#if activeWorkspace}
			<span class="text-muted-foreground" aria-hidden="true">/</span>
			<span class="shrink-0 text-muted-foreground">Todo items</span>
		{/if}
	</div>
</header>
