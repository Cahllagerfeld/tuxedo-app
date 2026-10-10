<script lang="ts">
	import { formatForDisplay, type Hotkey } from "@tanstack/svelte-hotkeys";
	import { shortcutPlatform } from "$lib/shared/keyboard";
	import * as Kbd from "$lib/shared/ui/kbd";
	let {
		binding,
		platform = shortcutPlatform,
	}: { binding: Hotkey; platform?: typeof shortcutPlatform } = $props();
</script>

<Kbd.Group aria-label={formatForDisplay(binding, { platform })}>
	{#each formatForDisplay(binding, { platform, parts: true }) as key}
		<Kbd.Root>{key}</Kbd.Root>
	{/each}
</Kbd.Group>
