<script lang="ts">
	import type { TodoFile } from "$lib/todo";
	import {
		parseWorkspaceConfigResponse,
		parseWorkspaceLoadResponse,
		type WorkspaceLoadResult,
	} from "$lib/workspace";
	import { Button } from "@/components/ui/button";
	import { invoke } from "@tauri-apps/api/core";
	import { open } from "@tauri-apps/plugin-dialog";
	import { onMount } from "svelte";

	let workspaceRoot = $state<string | null>(null);
	let todoPath = $state<string | null>(null);
	let todoFile = $state<TodoFile | null>(null);
	let warning = $state("");
	let error = $state("");
	let isLoading = $state(false);

	onMount(() => {
		void restoreWorkspace();
	});

	async function restoreWorkspace() {
		error = "";
		warning = "";
		isLoading = true;

		try {
			const response = await invoke("load_workspace_config");
			const config = parseWorkspaceConfigResponse(response);
			workspaceRoot = config.root;

			if (!config.root) {
				todoPath = null;
				todoFile = null;
				return;
			}

			await loadWorkspace(config.root);
		} catch (unknownError) {
			error = unknownError instanceof Error ? unknownError.message : String(unknownError);
		} finally {
			isLoading = false;
		}
	}

	async function openWorkspaceDirectory() {
		error = "";
		warning = "";
		isLoading = true;

		try {
			const root = await open({
				multiple: false,
				directory: true,
			});

			if (!root) {
				return;
			}

			const response = await invoke("save_workspace_config", { root });
			const config = parseWorkspaceConfigResponse(response);

			if (config.root) {
				await loadWorkspace(config.root);
			}
		} catch (unknownError) {
			error = unknownError instanceof Error ? unknownError.message : String(unknownError);
		} finally {
			isLoading = false;
		}
	}

	async function loadWorkspace(root: string) {
		const response = await invoke("load_workspace", { root });
		const workspace = parseWorkspaceLoadResponse(response);
		applyWorkspaceLoadResult(workspace);
	}

	function applyWorkspaceLoadResult(workspace: WorkspaceLoadResult) {
		workspaceRoot = workspace.root;
		todoPath = workspace.todo_path;
		todoFile = workspace.todo_file;
		warning = workspace.todo_exists
			? ""
			: `No todo.txt file was found in ${workspace.root}. Add one there or choose another directory.`;
	}
</script>

<main class="container">
	<section class="hero">
		<p class="eyebrow">todo.txt</p>
		<h1>Open your todo workspace</h1>
		<p>Choose the directory that contains todo.txt. Tuxedo will reopen it on startup.</p>
		<Button type="button" onclick={openWorkspaceDirectory} disabled={isLoading}>
			{isLoading ? "Loading..." : "Choose Directory"}
		</Button>
	</section>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if warning}
		<p class="warning" role="status">{warning}</p>
	{/if}

	{#if !workspaceRoot && !isLoading && !error}
		<section class="summary" aria-label="No workspace selected">
			<p><strong>No workspace selected.</strong></p>
			<p>Choose a directory to load its todo.txt file and remember it for next time.</p>
		</section>
	{/if}

	{#if workspaceRoot}
		<section class="summary" aria-label="Loaded workspace summary">
			<p><strong>Workspace:</strong> {workspaceRoot}</p>
			{#if todoPath}
				<p><strong>Todo file:</strong> {todoPath}</p>
			{/if}
		</section>
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
							<strong>Line {skipped.line_number}:</strong>
							{skipped.reason}
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

		.error {
			color: #ffb4c0;
			background: #3a141b;
		}

		.warning {
			color: #ffd699;
			background: #3a2600;
		}

		.todo-meta {
			color: #bbbbbb;
		}

		.todo-meta span {
			background: #333333;
		}
	}
</style>
