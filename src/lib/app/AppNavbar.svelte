<script lang="ts">
	import ShortcutHint from "$lib/shared/shortcuts/ShortcutHint.svelte";
	import { bindings } from "./shortcut-bindings";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import AppShortcuts from "./AppShortcuts.svelte";
	import type { AppState } from "./app-state.svelte";
	let { app }: { app: AppState } = $props();
</script>

<header
	class="flex h-(--window-toolbar-height) shrink-0 items-center gap-2 bg-window-background pl-24 text-sm font-medium text-muted-foreground select-none [app-region:drag]"
>
	<Sidebar.Trigger class="[app-region:no-drag]" />
	<ShortcutHint hotkey={bindings.sidebar.key} />
	<span>Tuxedo</span>
	<AppShortcuts {app} />
</header>
