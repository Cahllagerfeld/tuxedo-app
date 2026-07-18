<script lang="ts">
	import type { TodoItem } from "$lib/modules/todo/domain/todo";
	import type { TodoState } from "$lib/modules/todo/state/todo-state.svelte";
	import TodoList from "$lib/modules/todo/ui/TodoList.svelte";
	import type { WorkspaceState } from "$lib/modules/workspace/state/workspace-state.svelte";
	import * as Alert from "$lib/shared/ui/alert";
	import { Button } from "$lib/shared/ui/button";
	import * as Empty from "$lib/shared/ui/empty";
	import FolderOpen from "@lucide/svelte/icons/folder-open";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import { toast } from "svelte-sonner";
	import { showTodoFileConflictNotice } from "$lib/modules/todo/ui/todo-file-notices";

	type Props = {
		workspace: WorkspaceState;
		todoState: TodoState;
		openWorkspaceCreationDialog: () => void;
	};

	let { workspace, todoState, openWorkspaceCreationDialog }: Props = $props();

	async function toggleTodoCompletion(todo: TodoItem) {
		try {
			const result = await todoState.setCompletion(todo);
			if (result === "conflict") {
				showTodoFileConflictNotice();
			}
		} catch (error) {
			toast.error("Could not update Todo item", {
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
	<Empty.Root aria-label="Workspace catalogue unavailable" class="min-h-full rounded-none border-0">
		<Alert.Root variant="destructive">
			<Alert.Title>Workspaces unavailable</Alert.Title>
			<Alert.Description>{workspace.session.error}</Alert.Description>
		</Alert.Root>
	</Empty.Root>
{:else}
	{#if workspace.notice}
		<Alert.Root variant="destructive" class="mb-4">
			<Alert.Title>Workspace operation failed</Alert.Title>
			<Alert.Description>{workspace.notice.message}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if workspace.todoFile}
		<TodoList
			todoFile={workspace.todoFile}
			disabled={todoState.isMutationPending}
			onToggleComplete={toggleTodoCompletion}
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
