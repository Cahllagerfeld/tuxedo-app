<script lang="ts">
	import { getAppState } from "$lib/app/app-context";

	const appState = getAppState();
</script>

{#if appState.workspace.error}
	<p class="error" role="alert">{appState.workspace.error}</p>
{/if}

{#if appState.workspace.warning}
	<p class="warning" role="status">{appState.workspace.warning}</p>
{/if}

{#if !appState.workspace.root && !appState.workspace.isLoading && !appState.workspace.error}
	<section class="summary" aria-label="No workspace selected">
		<p><strong>No workspace selected.</strong></p>
		<p>Choose a directory to load its todo.txt file and remember it for next time.</p>
	</section>
{/if}

{#if appState.workspace.root}
	<section class="summary" aria-label="Loaded workspace summary">
		<p><strong>Workspace:</strong> {appState.workspace.root}</p>
		{#if appState.workspace.todoPath}
			<p><strong>Todo file:</strong> {appState.workspace.todoPath}</p>
		{/if}
	</section>
{/if}

<style>
	p {
		margin-top: 0;
	}

	.summary {
		border: 1px solid #d8d8d8;
		border-radius: 12px;
		padding: 1rem;
		background: #ffffff;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}

	.error {
		border: 1px solid #b00020;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		color: #b00020;
		background: #fff1f3;
	}

	.warning {
		border: 1px solid #b26a00;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		color: #6f4200;
		background: #fff8e8;
	}

	@media (prefers-color-scheme: dark) {
		.summary {
			border-color: #555555;
			background: #1f1f1f;
		}

		.error {
			color: #ffb4c0;
			background: #3a141b;
		}

		.warning {
			color: #ffd699;
			background: #3a2600;
		}
	}
</style>
