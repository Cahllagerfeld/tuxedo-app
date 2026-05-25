<script lang="ts">
	import TodoList from "$lib/components/todo/TodoList.svelte";
	import WorkspaceHero from "$lib/components/workspace/WorkspaceHero.svelte";
	import WorkspaceStatus from "$lib/components/workspace/WorkspaceStatus.svelte";
	import { setAppState } from "$lib/state/app-context";
	import { AppState } from "$lib/state/app-state.svelte";
	import { onMount } from "svelte";

	const appState = new AppState();
	setAppState(appState);

	onMount(() => {
		void appState.workspace.restore();
	});
</script>

<main class="container">
	<WorkspaceHero />
	<WorkspaceStatus />
	<TodoList />
</main>

<style>
	:root {
		font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
		font-size: 16px;
		line-height: 24px;
		font-weight: 400;

		color: #0f0f0f;
		background-color: #f6f6f6;

		font-synthesis: none;
		text-rendering: optimizeLegibility;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		-webkit-text-size-adjust: 100%;
	}

	.container {
		max-width: 900px;
		margin: 0 auto;
		padding: 10vh 1.5rem 3rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	@media (prefers-color-scheme: dark) {
		:root {
			color: #f6f6f6;
			background-color: #2f2f2f;
		}
	}
</style>
