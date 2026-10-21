<script lang="ts">
	import { SIDEBAR_SHORTCUT } from "./constants";
	import { formatForDisplay } from "@tanstack/svelte-hotkeys";
	import PanelLeftIcon from "@lucide/svelte/icons/panel-left";
	import { Button } from "$lib/shared/ui/button/index.js";
	import { cn } from "$lib/shared/utils.js";
	import { useSidebar } from "./context.svelte.js";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		onclick,
		...restProps
	}: ComponentProps<typeof Button> & {
		onclick?: (e: MouseEvent) => void;
	} = $props();

	const sidebar = useSidebar();
</script>

<Button
	bind:ref
	title={`Toggle Sidebar (${formatForDisplay(SIDEBAR_SHORTCUT.key)})`}
	data-sidebar="trigger"
	data-slot="sidebar-trigger"
	variant="ghost"
	size="icon-sm"
	class={cn(className)}
	type="button"
	onclick={(e) => {
		onclick?.(e);
		sidebar.toggle();
	}}
	{...restProps}
>
	<PanelLeftIcon class="cn-rtl-flip" />
	<span class="sr-only">Toggle Sidebar</span>
</Button>
