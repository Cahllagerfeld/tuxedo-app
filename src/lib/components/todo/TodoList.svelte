<script lang="ts">
	import { getAppState } from "$lib/state/app-context";
	import TodoFilters from "./TodoFilters.svelte";

	const appState = getAppState();
</script>

{#if appState.workspace.todoFile}
	<section class="summary" aria-label="Loaded todo file summary">
		<p><strong>Loaded:</strong> {appState.workspace.todoFile.path}</p>
		<p>
			{appState.todos.visibleCount} of {appState.todos.totalCount} parsed items shown,
			{appState.todos.skipped.length} skipped lines
		</p>
	</section>

	{#if appState.todos.items.length > 0}
		<TodoFilters />

		{#if appState.todos.filteredItems.length > 0}
			<ul class="todo-list">
				{#each appState.todos.filteredItems as item (item.line_number)}
					<li class={{ completed: item.completed }}>
						<div class="todo-main">
							{#if item.priority}
								<span class="priority">({item.priority})</span>
							{/if}
							<span>{item.description}</span>
						</div>

						<div class="todo-meta">
							<span>line {item.line_number}</span>
							{#if item.creation_date}
								<span>created {item.creation_date}</span>
							{/if}
							{#if item.completion_date}
								<span>completed {item.completion_date}</span>
							{/if}
							{#each item.projects as project (project)}
								<span>+{project}</span>
							{/each}
							{#each item.contexts as context (context)}
								<span>@{context}</span>
							{/each}
							{#each Object.entries(item.metadata) as [key, value] (key)}
								<span>{key}:{value}</span>
							{/each}
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p>No todo items match the selected filters.</p>
		{/if}
	{:else}
		<p>No valid todo items were found.</p>
	{/if}

	{#if appState.todos.skipped.length > 0}
		<section class="skipped">
			<h2>Skipped lines</h2>
			<ul>
				{#each appState.todos.skipped as skipped (skipped.line_number)}
					<li>
						<strong>Line {skipped.line_number}:</strong>
						{skipped.reason}
						<code>{skipped.raw}</code>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
{/if}

<style>
	h2,
	p {
		margin-top: 0;
	}

	.summary,
	.skipped,
	.todo-list li {
		border: 1px solid #d8d8d8;
		border-radius: 12px;
		background: #ffffff;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}

	.summary,
	.skipped {
		padding: 1rem;
	}

	.todo-list,
	.skipped ul {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.todo-list li {
		padding: 1rem;
	}

	.todo-list li.completed .todo-main {
		text-decoration: line-through;
		opacity: 0.7;
	}

	.todo-main {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		font-size: 1.1rem;
	}

	.priority {
		color: #396cd8;
		font-weight: 700;
	}

	.todo-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.75rem;
		color: #555555;
		font-size: 0.85rem;
	}

	.todo-meta span {
		border-radius: 999px;
		padding: 0.15rem 0.5rem;
		background: #eeeeee;
	}

	code {
		display: block;
		margin-top: 0.25rem;
		white-space: pre-wrap;
	}

	@media (prefers-color-scheme: dark) {
		.summary,
		.skipped,
		.todo-list li {
			border-color: #555555;
			background: #1f1f1f;
		}

		.todo-meta {
			color: #bbbbbb;
		}

		.todo-meta span {
			background: #333333;
		}
	}
</style>
