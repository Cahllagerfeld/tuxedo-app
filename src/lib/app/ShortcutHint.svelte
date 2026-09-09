<script lang="ts">
	import { detectPlatform, formatForDisplay } from "@tanstack/svelte-hotkeys";
	import * as Kbd from "$lib/shared/ui/kbd";
	import { untrack } from "svelte";

	type Props = { hotkey: string; class?: string };
	let { hotkey, class: className }: Props = $props();
	const platform = detectPlatform();
	const display = formatForDisplay(
		untrack(() => hotkey),
		{ platform }
	);
	const label = formatForDisplay(
		untrack(() => hotkey),
		{ platform, useSymbols: false }
	);
	const keys = display.split(/[+ ]/);
</script>

<Kbd.Group class={className} aria-label={label}>
	{#each keys as key (key)}<Kbd.Root>{key}</Kbd.Root>{/each}
</Kbd.Group>
