<script lang="ts">
	import { getAppState } from "$lib/state/app-context";
	import SelectedFilters from "./SelectedFilters.svelte";

	const appState = getAppState();
</script>

<section class="filters" aria-label="Todo filters">
	<label>
		<span>Filter todos</span>
		<input
			type="search"
			placeholder="Search description, metadata, +project, @context, or priority"
			bind:value={appState.filters.query}
		/>
	</label>

	<SelectedFilters />

	{#if appState.todos.availableProjects.length > 0}
		<div class="chips" aria-label="Project filters">
			<span>Projects</span>
			{#each appState.todos.availableProjects as project (project)}
				<button
					type="button"
					class={["filter-chip", { selected: appState.filters.selectedProjects.includes(project) }]}
					aria-pressed={appState.filters.selectedProjects.includes(project)}
					onclick={() => appState.filters.toggleProject(project)}
				>
					+{project}
				</button>
			{/each}
		</div>
	{/if}

	{#if appState.todos.availableContexts.length > 0}
		<div class="chips" aria-label="Context filters">
			<span>Contexts</span>
			{#each appState.todos.availableContexts as context (context)}
				<button
					type="button"
					class={["filter-chip", { selected: appState.filters.selectedContexts.includes(context) }]}
					aria-pressed={appState.filters.selectedContexts.includes(context)}
					onclick={() => appState.filters.toggleContext(context)}
				>
					@{context}
				</button>
			{/each}
		</div>
	{/if}

	{#if appState.todos.availablePriorities.length > 0}
		<div class="chips" aria-label="Priority filters">
			<span>Priorities</span>
			{#each appState.todos.availablePriorities as priority (priority)}
				<button
					type="button"
					class={[
						"filter-chip",
						{ selected: appState.filters.selectedPriorities.includes(priority) },
					]}
					aria-pressed={appState.filters.selectedPriorities.includes(priority)}
					onclick={() => appState.filters.togglePriority(priority)}
				>
					({priority})
				</button>
			{/each}
		</div>
	{/if}
</section>

<style>
	.filters {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		border: 1px solid #d8d8d8;
		border-radius: 12px;
		padding: 1rem;
		background: #ffffff;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		font-weight: 700;
	}

	input {
		border: 1px solid #c9c9c9;
		border-radius: 8px;
		padding: 0.6rem 0.75rem;
		font: inherit;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}

	.chips > span {
		margin-right: 0.25rem;
		font-size: 0.85rem;
		font-weight: 700;
		color: #555555;
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

	button:hover,
	button.selected {
		color: #ffffff;
		background: #396cd8;
	}

	@media (prefers-color-scheme: dark) {
		.filters {
			border-color: #555555;
			background: #1f1f1f;
		}

		input {
			border-color: #555555;
			color: #f6f6f6;
			background: #2f2f2f;
		}

		.chips > span {
			color: #bbbbbb;
		}

		button {
			background: #333333;
		}
	}
</style>
