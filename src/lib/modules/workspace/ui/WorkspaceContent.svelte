<script lang="ts">
	import { onMount, tick } from "svelte";
	import { createHotkey } from "@tanstack/svelte-hotkeys";
	import { getShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import { localToday } from "$lib/modules/todo/domain/todo-due";
	import type { TodoItem } from "$lib/modules/todo/domain/todo";
	import TodoEditorDialog from "$lib/modules/todo/ui/TodoEditorDialog.svelte";
	import TodoList from "$lib/modules/todo/ui/TodoList.svelte";
	import ActiveTodoFilters from "$lib/modules/todo/ui/ActiveTodoFilters.svelte";
	import * as Alert from "$lib/shared/ui/alert";
	import { Button } from "$lib/shared/ui/button";
	import { Input } from "$lib/shared/ui/input";
	import * as Empty from "$lib/shared/ui/empty";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import FolderOpen from "@lucide/svelte/icons/folder-open";
	import FileText from "@lucide/svelte/icons/file-text";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import Search from "@lucide/svelte/icons/search";
	import X from "@lucide/svelte/icons/x";
	import { toast } from "svelte-sonner";
	import type { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";
	import type { TodoFilterState } from "$lib/modules/todo/state/todo-filter.svelte";

	type Props = {
		creationOpen?: boolean;
		workspace: ElectronWorkspaceSessionState;
		todoFilter: TodoFilterState;
		filteredTodoItems: readonly TodoItem[];
		openWorkspaceCreationDialog: () => void;
	};

	let {
		creationOpen = $bindable(false),
		workspace,
		todoFilter,
		filteredTodoItems,
		openWorkspaceCreationDialog,
	}: Props = $props();
	let editingTodo = $state<TodoItem | null>(null);
	let todoList = $state<ReturnType<typeof TodoList>>();
	let editRecovery: ReturnType<ReturnType<typeof TodoList>["captureFocus"]> | undefined;
	let editingWorkspaceId = $state<string>();
	function startEdit(todo: TodoItem, trigger: HTMLButtonElement | null) {
		editRecovery = todoList?.captureFocus(todo, true, trigger);
		editingWorkspaceId = workspace.activeWorkspace?.id;
		editingTodo = todo;
	}
	function closeEdit(uncertain = false) {
		editingTodo = null;
		void editRecovery?.restore(uncertain);
	}

	let todoViewport = $state<HTMLElement | null>(null);
	let searchInput = $state<HTMLInputElement | null>(null);
	let searchButton = $state<HTMLButtonElement | null>(null);
	let searchOpen = $state(false);
	const searchId = $props.id();
	async function openSearch() {
		searchOpen = true;
		await tick();
		searchInput?.focus();
	}
	function toggleSearch() {
		if (searchOpen) {
			todoFilter.clearSearch();
			searchOpen = false;
			searchButton?.focus();
		} else {
			void openSearch();
		}
	}
	const shortcutScope = getShortcutScope();
	createHotkey("Mod+F", toggleSearch, () => ({
		enabled: (shortcutScope?.available ?? true) && !!workspace.todoFile && !workspace.isOperating,
		ignoreInputs: false,
		preventDefault: true,
		requireReset: true,
	}));

	onMount(() => {
		let timer: ReturnType<typeof setTimeout>;
		function refreshDate() {
			clearTimeout(timer);
			const now = new Date();
			todoFilter.today = localToday(now);
			const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
			timer = setTimeout(refreshDate, midnight.getTime() - now.getTime());
		}
		refreshDate();
		window.addEventListener("focus", refreshDate);
		document.addEventListener("visibilitychange", refreshDate);
		return () => {
			clearTimeout(timer);
			window.removeEventListener("focus", refreshDate);
			document.removeEventListener("visibilitychange", refreshDate);
		};
	});

	async function toggleTodoCompletion(todo: TodoItem) {
		const recovery = todoList?.captureFocus(todo);
		const result = await workspace.setCompletion(todo);
		void recovery?.restore(result.status === "conflict");
		if (result.status === "conflict") {
			toast.error("Todo file reloaded");
		} else if (result.status === "rejected") {
			toast.error("Could not update Todo item", { description: result.message });
		}
	}

	async function deleteTodoItem(todo: TodoItem, trigger?: HTMLButtonElement | null) {
		const recovery = todoList?.captureFocus(todo, false, trigger);
		const result = await workspace.deleteTodo(todo);
		void recovery?.restore(result.status === "conflict", result.status === "applied");
		if (result.status === "conflict") {
			toast.error("Todo file reloaded");
		} else if (result.status === "rejected") {
			toast.error("Could not delete Todo item", { description: result.message });
		}
	}

	async function reorderTodoItems(items: readonly TodoItem[]) {
		const result = await workspace.reorderTodo(items);
		if (result.status === "conflict") toast.error("Todo file reloaded");
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
			<div class="flex items-center gap-2">
				<Button
					bind:ref={searchButton}
					variant="ghost"
					size="icon"
					aria-label="Toggle Todo-item search"
					aria-expanded={searchOpen}
					aria-controls={searchId}
					disabled={workspace.isOperating}
					onclick={toggleSearch}
				>
					<Search class="size-4" aria-hidden="true" />
				</Button>
				<TodoEditorDialog
					bind:open={creationOpen}
					todoFile={workspace.todoFile}
					saveTodoItem={workspace.createTodo}
					workspaceName={workspace.activeWorkspace?.name ?? ""}
					initialProject={todoFilter.selectedProject}
					initialContext={todoFilter.selectedContext}
					disabled={workspace.isOperating}
				/>
			</div>
		</div>
		{#key workspace.activeWorkspace?.id + ":" + workspace.todoFile.path}
			{#if editingTodo && editingWorkspaceId === workspace.activeWorkspace?.id}
				<TodoEditorDialog
					todoFile={workspace.todoFile}
					todoToEdit={editingTodo}
					saveTodoItem={(draft) => workspace.editTodo(editingTodo!, draft)}
					workspaceName={workspace.activeWorkspace?.name ?? ""}
					disabled={workspace.isOperating}
					onClose={closeEdit}
				/>
			{/if}
		{/key}
		{#if searchOpen}
			<div id={searchId} class="shrink-0 border-b px-5 py-3">
				<div class="relative min-w-0">
					<Search
						class="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
						aria-hidden="true"
					/>
					<Input
						type="search"
						bind:ref={searchInput}
						bind:value={todoFilter.searchText}
						aria-label="Search Todo items"
						placeholder="Search Todo items…"
						disabled={workspace.isOperating}
						class="pr-9 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
					/>
					{#if todoFilter.searchText}
						<Button
							variant="ghost"
							size="icon-xs"
							class="absolute top-1 right-1"
							aria-label="Clear search"
							disabled={workspace.isOperating}
							onclick={todoFilter.clearSearch}
						>
							<X class="size-4" aria-hidden="true" />
						</Button>
					{/if}
				</div>
			</div>
		{/if}
		<ActiveTodoFilters {todoFilter} disabled={workspace.isOperating} />
	{/if}
	<div class="min-h-0 min-w-0 flex-1">
		<ScrollArea
			bind:viewportRef={todoViewport}
			class="h-full w-full"
			aria-label="Todo item results"
			viewportTabIndex={-1}
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
									No {todoFilter.status === "all"
										? ""
										: `${todoFilter.status} `}items{todoFilter.hasFilters
										? " match these filters"
										: ""}.
								</Empty.Title>
								<Empty.Description>
									{todoFilter.hasFilters
										? "Try clearing a filter to see more Todo items."
										: "There are no Todo items in this completion view."}
								</Empty.Description>
							</Empty.Header>
							{#if todoFilter.hasFilters}
								{#if todoFilter.hasSearch}
									<Button
										variant="outline"
										disabled={workspace.isOperating}
										onclick={todoFilter.clearSearch}>Clear search</Button
									>
								{/if}
								<Button disabled={workspace.isOperating} onclick={todoFilter.clear}
									>Clear filters</Button
								>
							{/if}
						</Empty.Root>
					{/if}
					<TodoList
						today={todoFilter.today}
						showEmpty={workspace.todoFile.items.length === 0}
						bind:this={todoList}
						fallback={todoViewport}
						workspaceId={workspace.activeWorkspace?.id ?? ""}
						scrollElement={todoViewport}
						todoFile={workspace.todoFile}
						items={filteredTodoItems}
						disabled={workspace.isOperating}
						onToggleComplete={toggleTodoCompletion}
						onDelete={deleteTodoItem}
						onEdit={startEdit}
						onReorder={reorderTodoItems}
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
