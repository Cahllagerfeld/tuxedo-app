<script lang="ts">
	import { formatForDisplay } from "@tanstack/svelte-hotkeys";
	import * as Kbd from "$lib/shared/ui/kbd";
	let { hotkey }: { hotkey: string } = $props();
</script>

<Kbd.Group aria-hidden="true"><Kbd.Root>{formatForDisplay(hotkey)}</Kbd.Root></Kbd.Group>
