<script lang="ts">
	import { getAppState } from "$lib/state/app-context";

	const appState = getAppState();
</script>

{#if appState.todos.selectedFilterChips.length > 0}
	<div class="selected" aria-label="Selected filters">
		{#each appState.todos.selectedFilterChips as chip (`${chip.kind}:${chip.value}`)}
			<button type="button" onclick={() => appState.filters.removeChip(chip)}>
				{chip.label}
				<span aria-hidden="true">x</span>
			</button>
		{/each}
		<button type="button" class="clear" onclick={appState.filters.clear}>Clear filters</button>
	</div>
{/if}

<style>
	.selected {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}

	button {
		border: 0;
		border-radius: 999px;
		padding: 0.2rem 0.6rem;
		color: inherit;
		background: #eeeeee;
		font: inherit;
		cursor: pointer;
	}

	button:hover {
		color: #ffffff;
		background: #396cd8;
	}

	.clear {
		background: transparent;
		color: #396cd8;
	}

	@media (prefers-color-scheme: dark) {
		button {
			background: #333333;
		}
	}
</style>
