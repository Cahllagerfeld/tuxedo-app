<script lang="ts">
	import { formatForDisplay } from "@tanstack/svelte-hotkeys";
	import { shortcutPlatform, shortcuts } from "$lib/shared/shortcuts";
	import * as Kbd from "$lib/shared/ui/kbd";
	let {
		shortcut,
		platform = shortcutPlatform,
	}: { shortcut: keyof typeof shortcuts; platform?: typeof shortcutPlatform } = $props();
</script>

<Kbd.Group aria-label={formatForDisplay(shortcuts[shortcut].binding, { platform })}>
	{#each formatForDisplay(shortcuts[shortcut].binding, { platform, parts: true }) as key}
		<Kbd.Root>{key}</Kbd.Root>
	{/each}
</Kbd.Group>
