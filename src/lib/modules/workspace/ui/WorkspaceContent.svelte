<script lang="ts">
	import { onMount, tick } from "svelte";
	import { createHotkey } from "@tanstack/svelte-hotkeys";
	import { getShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import { localToday } from "$lib/modules/todo/domain/todo-due";
	import type { TodoItem } from "$lib/modules/todo/domain/todo";
	import TodoEditorDialog from "$lib/modules/todo/ui/TodoEditorDialog.svelte";
	import TodoList from "$lib/modules/todo/ui/TodoList.svelte";
	import TodoDetails from "$lib/modules/todo/ui/TodoDetails.svelte";
	import type { TodoItemDraft, SaveTodoItemResult } from "$lib/modules/todo/ui/todo-editor-types";
	import * as Resizable from "$lib/shared/ui/resizable";
	import * as Sheet from "$lib/shared/ui/sheet";
	import { MediaQuery } from "svelte/reactivity";
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
	import { searchShortcut } from "./shortcuts";

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
	let detailEditTrigger: HTMLButtonElement | null = null;
	let selected = $state.raw<TodoItem | null>(null);
	let selectedWorkspaceId = $state<string>();
	let selectedPath = $state<string>();
	let detailUpdating = $state(false);
	const wide = new MediaQuery("(min-width: 1100px)");
	let previousWide: boolean | undefined;
	let desktopDetails = $state<HTMLElement | null>(null);
	const selectedTodo = $derived(
		selectedWorkspaceId === workspace.activeWorkspace?.id &&
			selectedPath === workspace.todoFile?.path
			? (workspace.todoFile?.items.find(
					(item) => item.line_number === selected?.line_number && item.raw === selected?.raw
				) ?? (detailUpdating ? selected : null))
			: null
	);
	function selectTodo(todo: TodoItem) {
		selected = todo;
		selectedWorkspaceId = workspace.activeWorkspace?.id;
		selectedPath = workspace.todoFile?.path;
	}
	function closeDetails() {
		const todo = selectedTodo;
		selected = null;
		if (todo) void todoList?.focusTodo(todo);
	}
	// External file/lifecycle changes can invalidate a physical-line selection. Restore DOM focus before removing its surface.
	$effect.pre(() => {
		const isWide = wide.current;
		if (previousWide !== isWide) {
			const ownedFocus = document.activeElement?.closest("[data-todo-details]");
			previousWide = isWide;
			if (isWide && ownedFocus)
				void tick().then(() => desktopDetails?.querySelector<HTMLButtonElement>("button")?.focus());
		}
		if (selected && !selectedTodo && !detailUpdating) {
			if (document.activeElement?.closest("[data-todo-details]")) todoViewport?.focus();
			selected = null;
		}
	});
	function retargetDetails(todo: TodoItem, result: SaveTodoItemResult, line = todo.line_number) {
		if (
			selected?.line_number !== todo.line_number ||
			selected?.raw !== todo.raw ||
			selectedWorkspaceId !== workspace.activeWorkspace?.id
		)
			return;
		if (result.status === "applied")
			selected = workspace.todoFile?.items.find((item) => item.line_number === line) ?? null;
		else if (result.status === "conflict") selected = null;
	}
	async function saveEditedTodo(draft: TodoItemDraft) {
		const todo = editingTodo!;
		detailUpdating = true;
		try {
			const result = await workspace.editTodo(todo, draft);
			retargetDetails(todo, result);
			return result;
		} finally {
			detailUpdating = false;
		}
	}
	function startEdit(todo: TodoItem, trigger: HTMLButtonElement | null) {
		detailEditTrigger = trigger?.closest("[data-todo-details]") ? trigger : null;
		editRecovery = detailEditTrigger ? undefined : todoList?.captureFocus(todo, true, trigger);
		editingWorkspaceId = workspace.activeWorkspace?.id;
		editingTodo = todo;
	}
	function closeEdit(uncertain = false) {
		editingTodo = null;
		if (detailEditTrigger) {
			const trigger = detailEditTrigger;
			detailEditTrigger = null;
			void tick().then(() => {
				if (!uncertain && trigger.isConnected) trigger.focus();
				else todoViewport?.focus();
			});
		} else void editRecovery?.restore(uncertain);
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
	createHotkey(searchShortcut.key, toggleSearch, () => ({
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
		detailUpdating = true;
		const result = await workspace.setCompletion(todo);
		retargetDetails(todo, result);
		detailUpdating = false;
		void recovery?.restore(result.status === "conflict");
		if (result.status === "conflict") {
			toast.error("Todo file reloaded");
		} else if (result.status === "rejected") {
			toast.error("Could not update Todo item", { description: result.message });
		}
	}

	async function deleteTodoItem(todo: TodoItem, trigger?: HTMLButtonElement | null) {
		const recovery = todoList?.captureFocus(todo, false, trigger);
		detailUpdating = true;
		const result = await workspace.deleteTodo(todo);
		if (
			result.status === "applied" &&
			selected?.line_number === todo.line_number &&
			selected?.raw === todo.raw
		) {
			selected = null;
			if (trigger?.closest("[data-todo-details]")) todoViewport?.focus();
		} else retargetDetails(todo, result);
		detailUpdating = false;
		void recovery?.restore(result.status === "conflict", result.status === "applied");
		if (result.status === "conflict") {
			toast.error("Todo file reloaded");
		} else if (result.status === "rejected") {
			toast.error("Could not delete Todo item", { description: result.message });
		}
	}

	async function reorderTodoItems(items: readonly TodoItem[]) {
		const todo = selectedTodo;
		const index = todo
			? items.findIndex((item) => item.line_number === todo.line_number && item.raw === todo.raw)
			: -1;
		const lines = items.map((item) => item.line_number).sort((a, b) => a - b);
		detailUpdating = true;
		const result = await workspace.reorderTodo(items);
		if (todo) retargetDetails(todo, result, index < 0 ? todo.line_number : lines[index]);
		detailUpdating = false;
		if (result.status === "conflict") toast.error("Todo file reloaded");
		else if (result.status === "rejected")
			toast.error("Could not reorder Todo items", { description: result.message });
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (
			event.key === "Escape" &&
			wide.current &&
			selectedTodo &&
			!editingTodo &&
			(shortcutScope?.available ?? true) &&
			!event.defaultPrevented
		) {
			event.preventDefault();
			closeDetails();
		}
	}}
/>

{#snippet details()}
	{#if selectedTodo && workspace.todoFile}
		<TodoDetails
			todo={selectedTodo}
			path={workspace.todoFile.path}
			disabled={workspace.isOperating}
			onClose={closeDetails}
			onEdit={startEdit}
			onToggleComplete={toggleTodoCompletion}
			onDelete={deleteTodoItem}
		/>
	{/if}
{/snippet}

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
					saveTodoItem={saveEditedTodo}
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
	{#snippet results()}
		<div class="min-h-0 min-w-0 flex-1">
			<ScrollArea
				bind:viewportRef={todoViewport}
				class="h-full w-full"
				aria-label="Todo item results"
				viewportTabIndex={-1}
			>
				{#if workspace.session.status === "loading"}
					<Empty.Root
						aria-label="Loading workspace session"
						class="min-h-full rounded-none border-0"
					>
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
							{selectedTodo}
							onSelect={selectTodo}
							onNavigate={(todo) => {
								if (selectedTodo && wide.current) selectTodo(todo);
							}}
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
	{/snippet}
	<div class="min-h-0 min-w-0 flex-1">
		<Resizable.PaneGroup direction="horizontal">
			<Resizable.Pane defaultSize={58} minSize={35} class="flex min-h-0 flex-col">
				{@render results()}
			</Resizable.Pane>
			{#if selectedTodo && wide.current}
				<Resizable.Handle aria-label="Resize Todo item details" />
				<Resizable.Pane defaultSize={42} minSize={35} maxSize={65}>
					<aside bind:this={desktopDetails} aria-label="Todo item details" class="h-full">
						{@render details()}
					</aside>
				</Resizable.Pane>
			{/if}
		</Resizable.PaneGroup>
	</div>
	{#if !wide.current}
		<Sheet.Root
			open={!!selectedTodo}
			onOpenChange={(open) => {
				if (!open) closeDetails();
			}}
		>
			<Sheet.Content
				class="w-full gap-0 sm:max-w-[440px]"
				showCloseButton={false}
				onCloseAutoFocus={(event) => event.preventDefault()}
			>
				<Sheet.Title class="sr-only">Todo item details</Sheet.Title>
				<Sheet.Description class="sr-only"
					>Full description, attributes, and raw line.</Sheet.Description
				>
				{@render details()}
			</Sheet.Content>
		</Sheet.Root>
	{/if}
</div>
