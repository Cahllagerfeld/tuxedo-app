<script lang="ts">
	import { getAppState } from "$lib/state/app-context";
	import { Button } from "@/components/ui/button";

	const appState = getAppState();
</script>

<section class="hero">
	<p class="eyebrow">todo.txt</p>
	<h1>Open your todo workspace</h1>
	<p>Choose the directory that contains todo.txt. Tuxedo will reopen it on startup.</p>
	<Button type="button" onclick={appState.workspace.openDirectory} disabled={appState.workspace.isLoading}>
		{appState.workspace.isLoading ? "Loading..." : "Choose Directory"}
	</Button>
</section>

<style>
	.hero {
		text-align: center;
	}

	.eyebrow {
		margin: 0;
		color: #396cd8;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	h1,
	p {
		margin-top: 0;
	}
</style>
