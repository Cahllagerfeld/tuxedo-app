<script lang="ts">
	import type { TodoItem } from "$lib/modules/todo/domain/todo";
	import TodoCreationDialog from "$lib/modules/todo/ui/TodoCreationDialog.svelte";
	import TodoList from "$lib/modules/todo/ui/TodoList.svelte";
	import * as Alert from "$lib/shared/ui/alert";
	import { Button } from "$lib/shared/ui/button";
	import * as Empty from "$lib/shared/ui/empty";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import FolderOpen from "@lucide/svelte/icons/folder-open";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import { toast } from "svelte-sonner";
	import type { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";

	type Props = {
		workspace: ElectronWorkspaceSessionState;
		openWorkspaceCreationDialog: () => void;
	};

	let { workspace, openWorkspaceCreationDialog }: Props = $props();

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

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	{#if workspace.todoFile}
		<div class="flex shrink-0 items-center justify-between border-b px-5 py-3">
			<div>
				<p class="text-sm font-medium">Todo items</p>
				<p class="text-xs text-muted-foreground">{workspace.todoFile.items.length} items</p>
			</div>
			<TodoCreationDialog
				todoFile={workspace.todoFile}
				createTodoItem={workspace.createTodo}
				workspaceName={workspace.activeWorkspace?.name ?? ""}
				disabled={workspace.isOperating}
			/>
		</div>
	{/if}
	<div class="min-h-0 flex-1">
		<ScrollArea class="h-full w-full">
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
		</ScrollArea>
	</div>
</div>
