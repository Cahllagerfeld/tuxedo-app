<script lang="ts">
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import type { Snippet } from "svelte";
	let { children }: { children?: Snippet } = $props();
</script>

<header
	class="flex h-(--window-toolbar-height) shrink-0 items-center gap-2 bg-sidebar pl-24 text-sm font-medium text-muted-foreground select-none [app-region:drag]"
>
	<Sidebar.Trigger class="[app-region:no-drag]" />
	<span>Tuxedo</span>
	<div class="ml-auto pr-3">{@render children?.()}</div>
</header>
