<script lang="ts">
	import * as Sidebar from "#lib/shared/ui/sidebar/index.js";
	import type { TodoFileSummary } from "#lib/modules/todo/domain/todo-file-summary.js";
	import Overview from "./Overview.svelte";
	import SidebarFilters from "./SidebarFilters.svelte";
	import type { TodoFilterState } from "#lib/modules/todo/state/todo-filter.svelte.js";

	type Props = {
		todoSummary: TodoFileSummary;
		activeWorkspaceId: string | null;
		disabled?: boolean;
		todoFilter: TodoFilterState;
		todoFileLoaded?: boolean;
		collapsible?: "offcanvas" | "icon" | "none";
	};

	let {
		todoSummary,
		activeWorkspaceId,
		disabled = false,
		todoFilter,
		todoFileLoaded = false,
		collapsible = "offcanvas",
	}: Props = $props();
</script>

<Sidebar.Root
	variant="sidebar"
	{collapsible}
	class={collapsible === "none" ? "workspace-sidebar" : "workspace-sidebar md:absolute md:h-full"}
>
	<Sidebar.Content class="min-w-0 gap-0 overflow-hidden px-2 pt-3">
		<div class="shrink-0">
			<Overview {todoSummary} {todoFilter} disabled={!todoFileLoaded || disabled} />
		</div>
		<div class="mx-2 my-2 shrink-0 border-t"></div>
		{#key activeWorkspaceId}
			<SidebarFilters {todoFilter} disabled={!todoFileLoaded || disabled} />
		{/key}
	</Sidebar.Content>
	<Sidebar.Footer class="p-4 text-xs text-muted-foreground">
		<span class="font-medium text-sidebar-foreground">Tuxedo</span>
		<span>Your Todo files, in one place.</span>
	</Sidebar.Footer>
</Sidebar.Root>
