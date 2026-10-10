<script lang="ts">
	import { setAppState } from "$lib/app/app-context";
	import { AppState } from "$lib/app/app-state.svelte";
	import AppShell from "$lib/app/AppShell.svelte";
	import "./layout.css";
	let { children } = $props();
	const appState = new AppState();
	setAppState(appState);
</script>

<AppShell {appState}>{@render children()}</AppShell>
