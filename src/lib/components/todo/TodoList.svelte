<script lang="ts">
	import { getAppState } from "$lib/state/app-context";
	import TodoFilters from "./TodoFilters.svelte";
	import TodoItem from "./TodoItem.svelte";

	const appState = getAppState();
</script>

{#if appState.workspace.todoFile}
	<!-- <section class="summary" aria-label="Loaded todo file summary">
		<p><strong>Loaded:</strong> {appState.workspace.todoFile.path}</p>
		<p>
			{appState.todos.visibleCount} of {appState.todos.totalCount} parsed items shown,
			{appState.todos.skipped.length} skipped lines
		</p>
	</section> -->

	{#if appState.todos.items.length > 0}
		<!-- <TodoFilters /> -->

		{#if appState.todos.filteredItems.length > 0}
			<ul class="space-y-1">
				{#each appState.todos.filteredItems as item (item.line_number)}
					<li>
						<TodoItem todo={item} />
						<!-- <div class="todo-main">
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
						</div> -->
					</li>
				{/each}
			</ul>
		{:else}
			<p>No todo items match the selected filters.</p>
		{/if}
	{:else}
		<p>No valid todo items were found.</p>
	{/if}

	<!-- {#if appState.todos.skipped.length > 0}
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
	{/if} -->
{/if}
