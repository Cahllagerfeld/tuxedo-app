<script lang="ts">
	import { formatForDisplay } from "@tanstack/svelte-hotkeys";
	import * as Kbd from "#lib/shared/ui/kbd/index.js";
	let { hotkey }: { hotkey: string } = $props();
</script>

<Kbd.Group><Kbd.Root>{formatForDisplay(hotkey)}</Kbd.Root></Kbd.Group>
