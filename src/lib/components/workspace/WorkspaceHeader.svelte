<script lang="ts">
	import { getAppState } from "$lib/state/app-context";
	import { Button } from "@/components/ui/button";

	const appState = getAppState();
</script>

<header class="h-12 bg-card border-b border-border flex items-center justify-between px-4">
	Header
</header>
<!-- <section class="hero">
	<p class="eyebrow">todo.txt</p>
	<h1>Open your todo workspace</h1>
	<p>Choose the directory that contains todo.txt. Tuxedo will reopen it on startup.</p>
	<Button
		type="button"
		onclick={appState.workspace.openDirectory}
		disabled={appState.workspace.isLoading}
	>
		{appState.workspace.isLoading ? "Loading..." : "Choose Directory"}
	</Button>
</section> -->
