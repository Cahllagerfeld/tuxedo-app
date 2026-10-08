<script lang="ts">
	import type { WorkspaceCatalogue } from "../domain/workspace";
	import type { TodoItem } from "$lib/modules/todo/domain/todo";
	import TodoList from "$lib/modules/todo/ui/TodoList.svelte";
	import type { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";
	import * as Alert from "$lib/shared/ui/alert";
	import { Button } from "$lib/shared/ui/button";
	import * as Sheet from "$lib/shared/ui/sheet";
	import * as Empty from "$lib/shared/ui/empty";
	import FolderOpen from "@lucide/svelte/icons/folder-open";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import { toast } from "svelte-sonner";

	type Props = {
		workspace: ElectronWorkspaceSessionState;
		openWorkspaceCreationDialog: () => void;
	};

	let { workspace, openWorkspaceCreationDialog }: Props = $props();
	// Scoped Todo-item updates retain this catalogue; lifecycle results replace it.
	let selection = $state.raw<{
		catalogue: WorkspaceCatalogue;
		line: number;
		description: string;
	} | null>(null);
	let selectedTodo = $derived(
		selection?.catalogue === workspace.catalogue
			? workspace.todoFile?.items.find(
					(todo) =>
						todo.line_number === selection?.line && todo.description === selection?.description
				)
			: undefined
	);
	function selectTodo(todo: TodoItem) {
		if (workspace.catalogue)
			selection = {
				catalogue: workspace.catalogue,
				line: todo.line_number,
				description: todo.description,
			};
	}

	async function toggleTodoCompletion(todo: TodoItem) {
		try {
			const result = await workspace.setCompletion(todo);
			if (result.status === "conflict") {
				toast.error("Todo file changed externally; reloaded latest version");
			} else if (result.status === "rejected") {
				toast.error("Could not update Todo item", { description: result.message });
			}
		} catch (error) {
			toast.error("Could not update Todo item", {
				description: errorMessage(error),
			});
		}
	}

	async function deleteTodoItem(todo: TodoItem) {
		try {
			const result = await workspace.deleteTodo(todo);
			if (result.status === "applied" || result.status === "conflict") selection = null;
			if (result.status === "conflict") {
				toast.error("Todo file changed externally; reloaded latest version");
			} else if (result.status === "rejected") {
				toast.error("Could not delete Todo item", { description: result.message });
			}
		} catch (error) {
			toast.error("Could not delete Todo item", {
				description: errorMessage(error),
			});
		}
	}

	function errorMessage(error: unknown) {
		if (error instanceof Error) return error.message;
		if (
			typeof error === "object" &&
			error !== null &&
			"message" in error &&
			typeof error.message === "string"
		) {
			return error.message;
		}
		return String(error);
	}
</script>

<div class="min-h-0 flex-1 overflow-y-auto">
	{#if workspace.session.status === "loading"}
		<Empty.Root aria-label="Loading workspace session" class="min-h-full rounded-none border-0">
			<Empty.Media variant="icon"
				><LoaderCircle class="animate-spin" aria-hidden="true" /></Empty.Media
			>
			<Empty.Header>
				<Empty.Title>Loading workspaces…</Empty.Title>
				<Empty.Description>Restoring your Workspace session.</Empty.Description>
			</Empty.Header>
		</Empty.Root>
	{:else if workspace.session.status === "unavailable"}
		<Empty.Root
			aria-label="Workspace catalogue unavailable"
			class="min-h-full rounded-none border-0"
		>
			<Alert.Root variant="destructive">
				<Alert.Title>Workspaces unavailable</Alert.Title>
				<Alert.Description>{workspace.session.error}</Alert.Description>
			</Alert.Root>
		</Empty.Root>
	{:else}
		{#if workspace.todoFile}
			<TodoList
				todoFile={workspace.todoFile}
				disabled={workspace.isOperating}
				onToggleComplete={toggleTodoCompletion}
				onDelete={deleteTodoItem}
				onSelect={selectTodo}
			/>
		{:else}
			<Empty.Root aria-label="No active workspace">
				<Empty.Media variant="icon"><FolderOpen aria-hidden="true" /></Empty.Media>
				<Empty.Header>
					<Empty.Title>No workspace open</Empty.Title>
					<Empty.Description
						>Open or create a Workspace to start working with a Todo file.</Empty.Description
					>
				</Empty.Header>
				<Button
					disabled={workspace.isOperating || workspace.isLoading}
					onclick={openWorkspaceCreationDialog}>New workspace</Button
				>
				{#if workspace.warning}
					<p role="status">{workspace.warning}</p>
				{/if}
			</Empty.Root>
		{/if}
	{/if}
</div>
<Sheet.Root
	open={selectedTodo !== undefined}
	onOpenChange={(open) => {
		if (!open) selection = null;
	}}
>
	<Sheet.Content
		side="right"
		class="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
	>
		{#if selectedTodo}
			<Sheet.Header>
				<Sheet.Title class="pr-8 leading-snug">{selectedTodo.description}</Sheet.Title>
				<Sheet.Description>Todo item · Line {selectedTodo.line_number}</Sheet.Description>
			</Sheet.Header>
			<div class="space-y-4 px-4 text-sm">
				<div class="flex items-center gap-2">
					<span class="text-muted-foreground">Status</span><span
						>{selectedTodo.completed ? "Completed" : "Open"}</span
					>
				</div>
				{#if selectedTodo.priority}<p>Priority ({selectedTodo.priority})</p>{/if}
				{#if selectedTodo.creation_date}<p>Created {selectedTodo.creation_date}</p>{/if}
				{#if selectedTodo.completion_date}<p>Completed {selectedTodo.completion_date}</p>{/if}
				{#if selectedTodo.projects.length}<div class="flex flex-wrap gap-2">
						{#each selectedTodo.projects as project (project)}<span
								class="rounded-md bg-muted px-2 py-1 font-mono text-xs">+{project}</span
							>{/each}
					</div>{/if}
				{#if selectedTodo.contexts.length}<div class="flex flex-wrap gap-2">
						{#each selectedTodo.contexts as context (context)}<span
								class="rounded-md bg-muted px-2 py-1 font-mono text-xs">@{context}</span
							>{/each}
					</div>{/if}
				{#if Object.keys(selectedTodo.metadata).length}<div class="space-y-1 font-mono text-xs">
						{#each Object.entries(selectedTodo.metadata) as [key, value] (key)}<p>
								{key}:{value}
							</p>{/each}
					</div>{/if}
				<div class="space-y-2">
					<p class="text-xs font-medium text-muted-foreground">Todo-file line</p>
					<pre
						class="rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">{selectedTodo.raw}</pre>
				</div>
			</div>
			<Sheet.Footer class="mt-auto">
				<Button
					variant="destructive"
					disabled={workspace.isOperating}
					onclick={() => {
						if (selectedTodo) void deleteTodoItem(selectedTodo);
					}}>Delete Todo item</Button
				>
				<Button
					disabled={workspace.isOperating}
					onclick={() => {
						if (selectedTodo) void toggleTodoCompletion(selectedTodo);
					}}>{selectedTodo.completed ? "Reopen Todo item" : "Complete Todo item"}</Button
				>
			</Sheet.Footer>
		{/if}
	</Sheet.Content>
</Sheet.Root>
