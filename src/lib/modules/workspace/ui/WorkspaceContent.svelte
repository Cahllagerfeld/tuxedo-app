<script lang="ts">
	import type { TodoItem } from "$lib/modules/todo/domain/todo";
	import TodoCreationDialog from "$lib/modules/todo/ui/TodoCreationDialog.svelte";
	import TodoList from "$lib/modules/todo/ui/TodoList.svelte";
	import ActiveTodoFilters from "$lib/modules/todo/ui/ActiveTodoFilters.svelte";
	import * as Alert from "$lib/shared/ui/alert";
	import { Button } from "$lib/shared/ui/button";
	import * as Empty from "$lib/shared/ui/empty";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import FolderOpen from "@lucide/svelte/icons/folder-open";
	import FileText from "@lucide/svelte/icons/file-text";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import { toast } from "svelte-sonner";
	import type { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";
	import type { TodoFilterState } from "$lib/modules/todo/state/todo-filter.svelte";

	type Props = {
		workspace: ElectronWorkspaceSessionState;
		todoFilter: TodoFilterState;
		filteredTodoItems: readonly TodoItem[];
		openWorkspaceCreationDialog: () => void;
	};

	let { workspace, todoFilter, filteredTodoItems, openWorkspaceCreationDialog }: Props = $props();
	let todoViewport = $state<HTMLElement | null>(null);

	async function toggleTodoCompletion(todo: TodoItem) {
		const result = await workspace.setCompletion(todo);
		if (result.status === "conflict") {
			toast.error("Todo file changed externally; reloaded latest version");
		} else if (result.status === "rejected") {
			toast.error("Could not update Todo item", { description: result.message });
		}
	}

	async function deleteTodoItem(todo: TodoItem) {
		const result = await workspace.deleteTodo(todo);
		if (result.status === "conflict") {
			toast.error("Todo file changed externally; reloaded latest version");
		} else if (result.status === "rejected") {
			toast.error("Could not delete Todo item", { description: result.message });
		}
	}

	async function reorderTodoItems(items: readonly TodoItem[]) {
		const result = await workspace.reorderTodo(items);
		if (result.status === "conflict")
			toast.error("Todo file changed externally; reloaded latest version");
		else if (result.status === "rejected")
			toast.error("Could not reorder Todo items", { description: result.message });
	}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	{#if workspace.todoFile}
		<div class="flex shrink-0 items-center justify-between border-b px-5 py-3">
			<div>
				<p class="text-sm font-medium">Todo items</p>
				<p aria-label="Filtered result count" class="text-xs text-muted-foreground">
					{filteredTodoItems.length} matching {filteredTodoItems.length === 1 ? "item" : "items"}
				</p>
			</div>
			<TodoCreationDialog
				todoFile={workspace.todoFile}
				createTodoItem={workspace.createTodo}
				workspaceName={workspace.activeWorkspace?.name ?? ""}
				disabled={workspace.isOperating}
			/>
		</div>
		<ActiveTodoFilters {todoFilter} disabled={workspace.isOperating} />
	{/if}
	<div class="min-h-0 min-w-0 flex-1">
		<ScrollArea
			bind:viewportRef={todoViewport}
			class="h-full w-full"
			aria-label="Todo item results"
		>
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
					{#if filteredTodoItems.length === 0 && workspace.todoFile.items.length > 0}
						<Empty.Root
							aria-label="No matching Todo items"
							class="min-h-full rounded-none border-0"
						>
							<Empty.Media variant="icon"><FileText aria-hidden="true" /></Empty.Media>
							<Empty.Header>
								<Empty.Title>
									No {todoFilter.status} items{todoFilter.hasFacetFilters
										? " match these filters"
										: ""}.
								</Empty.Title>
								<Empty.Description>
									{todoFilter.hasFacetFilters
										? "Try clearing a filter to see more Todo items."
										: "There are no Todo items in this completion view."}
								</Empty.Description>
							</Empty.Header>
							{#if todoFilter.hasFacetFilters}
								<Button disabled={workspace.isOperating} onclick={todoFilter.clear}
									>Clear filters</Button
								>
							{/if}
						</Empty.Root>
					{:else}
						<TodoList
							scrollElement={todoViewport}
							todoFile={workspace.todoFile}
							items={filteredTodoItems}
							disabled={workspace.isOperating}
							onToggleComplete={toggleTodoCompletion}
							onDelete={deleteTodoItem}
							onReorder={reorderTodoItems}
						/>
					{/if}
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
