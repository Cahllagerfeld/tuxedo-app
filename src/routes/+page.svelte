<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import { open } from "@tauri-apps/plugin-dialog";
	import { parseTodoFileResponse, type TodoFile } from "$lib/todo";

	let todoFile = $state<TodoFile | null>(null);
	let error = $state("");
	let isLoading = $state(false);

	async function openTodoFile() {
		error = "";
		isLoading = true;

		try {
			const path = await open({
				multiple: false,
				directory: false,
				filters: [{ name: "todo.txt", extensions: ["txt"] }],
			});

			if (!path) {
				return;
			}

			const response = await invoke("parse_todo_file", { path });
			todoFile = parseTodoFileResponse(response);
		} catch (unknownError) {
			error = unknownError instanceof Error ? unknownError.message : String(unknownError);
		} finally {
			isLoading = false;
		}
	}
</script>

<main class="container">
	<section class="hero">
		<p class="eyebrow">todo.txt</p>
		<h1>Open and parse your todo.txt file</h1>
		<p>Select an existing todo.txt file to parse it in Rust and display the valid tasks here.</p>
		<button type="button" onclick={openTodoFile} disabled={isLoading}>
			{isLoading ? "Opening..." : "Open"}
		</button>
	</section>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if todoFile}
		<section class="summary" aria-label="Loaded todo file summary">
			<p><strong>Loaded:</strong> {todoFile.path}</p>
			<p>{todoFile.items.length} parsed items, {todoFile.skipped.length} skipped lines</p>
		</section>

		{#if todoFile.items.length > 0}
			<ul class="todo-list">
				{#each todoFile.items as item}
					<li class:completed={item.completed}>
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
							{#each item.projects as project}
								<span>+{project}</span>
							{/each}
							{#each item.contexts as context}
								<span>@{context}</span>
							{/each}
							{#each Object.entries(item.metadata) as [key, value]}
								<span>{key}:{value}</span>
							{/each}
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p>No valid todo items were found.</p>
		{/if}

		{#if todoFile.skipped.length > 0}
			<section class="skipped">
				<h2>Skipped lines</h2>
				<ul>
					{#each todoFile.skipped as skipped}
						<li>
							<strong>Line {skipped.line_number}:</strong> {skipped.reason}
							<code>{skipped.raw}</code>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
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

	button {
		border-radius: 8px;
		border: 1px solid transparent;
		padding: 0.6em 1.2em;
		font-size: 1em;
		font-weight: 500;
		font-family: inherit;
		color: #0f0f0f;
		background-color: #ffffff;
		transition: border-color 0.25s;
		box-shadow: 0 2px 2px rgba(0, 0, 0, 0.2);
		cursor: pointer;
	}

	button:hover {
		border-color: #396cd8;
	}
	button:active {
		border-color: #396cd8;
		background-color: #e8e8e8;
	}

	button {
		outline: none;
	}

	button:disabled {
		cursor: wait;
		opacity: 0.7;
	}

	.error {
		border: 1px solid #b00020;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		color: #b00020;
		background: #fff1f3;
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
		:root {
			color: #f6f6f6;
			background-color: #2f2f2f;
		}

		.summary,
		.skipped,
		.todo-list li {
			border-color: #555555;
			background: #1f1f1f;
		}

		button {
			color: #ffffff;
			background-color: #0f0f0f98;
		}
		button:active {
			background-color: #0f0f0f69;
		}

		.error {
			color: #ffb4c0;
			background: #3a141b;
		}

		.todo-meta {
			color: #bbbbbb;
		}

		.todo-meta span {
			background: #333333;
		}
	}
</style>
