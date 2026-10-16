<script lang="ts">
	import { onMount, tick } from "svelte";
	import { createHotkey } from "@tanstack/svelte-hotkeys";
	import { getShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import { localToday } from "$lib/modules/todo/domain/todo-due";
	import type { TodoItem } from "$lib/modules/todo/domain/todo";
	import TodoEditorDialog from "$lib/modules/todo/ui/TodoEditorDialog.svelte";
	import WorkspaceTodoReader from "./WorkspaceTodoReader.svelte";
	import ActiveTodoFilters from "$lib/modules/todo/ui/ActiveTodoFilters.svelte";
	import * as Alert from "$lib/shared/ui/alert";
	import { Button } from "$lib/shared/ui/button";
	import * as DropdownMenu from "$lib/shared/ui/dropdown-menu";
	import { Input } from "$lib/shared/ui/input";
	import * as Empty from "$lib/shared/ui/empty";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import FolderOpen from "@lucide/svelte/icons/folder-open";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import SavedViews from "./SavedViews.svelte";
	import Search from "@lucide/svelte/icons/search";
	import ListFilter from "@lucide/svelte/icons/list-filter";
	import { toast } from "svelte-sonner";
	import X from "@lucide/svelte/icons/x";
	import type { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";
	import type { TodoFilterState } from "$lib/modules/todo/state/todo-filter.svelte";
	import { searchShortcut } from "./shortcuts";
	import { createTodoBulkSelection } from "./todo-bulk-selection.svelte";

	type Props = {
		creationOpen?: boolean;
		bulkSelection: ReturnType<typeof createTodoBulkSelection>;
		workspace: ElectronWorkspaceSessionState;
		todoFilter: TodoFilterState;
		filteredTodoItems: readonly TodoItem[];
		openWorkspaceCreationDialog: () => void;
	};

	let {
		creationOpen = $bindable(false),
		bulkSelection,
		workspace,
		todoFilter,
		filteredTodoItems,
		openWorkspaceCreationDialog,
	}: Props = $props();
	let emptyViewport = $state<HTMLElement | null>(null);
	// A session becoming Empty removes the reader and its focused surface. Transfer owned focus after the replacement mounts.
	$effect.pre(() => {
		if (
			!workspace.todoFile &&
			document.activeElement?.closest("[data-todo-reader], [data-todo-details]")
		) {
			void tick().then(() => emptyViewport?.focus());
		}
	});
	let searchInput = $state<HTMLInputElement | null>(null);
	let searchButton = $state<HTMLButtonElement | null>(null);
	let searchOpen = $state(false);
	const searchId = $props.id();
	const deferredCountId = `${searchId}-deferred-count`;
	async function openSearch() {
		searchOpen = true;
		await tick();
		searchInput?.focus();
	}
	function toggleSearch() {
		if (searchOpen || todoFilter.hasSearch) {
			todoFilter.clearSearch();
			searchOpen = false;
			searchButton?.focus();
		} else {
			void openSearch();
		}
	}
	const shortcutScope = getShortcutScope();
	let previousSelection: typeof bulkSelection.context | undefined;
	// Report invalidation to the external toast system; selection itself is derived.
	$effect(() => {
		if (workspace.isOperating) return;
		const current = bulkSelection.context;
		if (
			previousSelection &&
			previousSelection.workspaceKey === current.workspaceKey &&
			previousSelection.selection !== current.selection &&
			previousSelection.selection.value.size &&
			bulkSelection.active &&
			!workspace.isOperating
		) {
			toast.info(
				previousSelection.fileSignature !== current.fileSignature
					? "Selection cleared because the Todo file changed."
					: "Selection cleared because filters changed."
			);
		}
		previousSelection = current;
	});
	let reader = $state<ReturnType<typeof WorkspaceTodoReader>>();
	async function completeSelected() {
		const items = bulkSelection.selectedItems.filter((todo) => !todo.completed);
		if (!items.length) return;
		previousSelection = undefined;
		const result = await workspace.bulkSetCompletion(items);
		if (result.status === "applied") {
			const count = items.length;
			toast.success(`Completed ${count} ${count === 1 ? "Todo item" : "Todo items"}`);
			if (result.notice) toast.info(result.notice);
			bulkSelection.clear();
		} else if (result.status === "conflict") {
			toast.error("Todo file reloaded");
			bulkSelection.clear();
		} else toast.error("Could not complete Todo items", { description: result.message });
	}
	function enterSelectionMode() {
		reader?.closeDetails();
		bulkSelection.enter();
	}
	createHotkey(
		"Escape",
		() => bulkSelection.exit(),
		() => ({
			enabled: bulkSelection.active && !workspace.isOperating && (shortcutScope?.available ?? true),
			ignoreInputs: true,
			preventDefault: true,
		})
	);
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
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	{#if workspace.todoFile}
		<div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
			<div>
				{#if bulkSelection.active}
					<p class="text-sm font-medium" aria-live="polite">
						{bulkSelection.count} selected
					</p>
				{:else}
					<p class="text-sm font-medium">Todo items</p>
					<p aria-label="Filtered result count" class="text-xs text-muted-foreground">
						{filteredTodoItems.length} matching {filteredTodoItems.length === 1 ? "item" : "items"}
					</p>
				{/if}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				{#if bulkSelection.active}
					<Button
						variant="outline"
						size="sm"
						disabled={workspace.isOperating || filteredTodoItems.length === 0}
						onclick={bulkSelection.selectAll}>Select all</Button
					>
					<Button
						variant="outline"
						size="sm"
						disabled={workspace.isOperating || bulkSelection.count === 0}
						onclick={bulkSelection.clear}>Clear selection</Button
					>
					<Button
						size="sm"
						disabled={workspace.isOperating || bulkSelection.selectedOpenCount === 0}
						onclick={() => void completeSelected()}>Complete</Button
					>
					<Button
						variant="secondary"
						size="sm"
						disabled={workspace.isOperating}
						onclick={bulkSelection.exit}>Done</Button
					>
				{:else}
					<Button
						variant="outline"
						size="sm"
						disabled={workspace.isOperating}
						onclick={enterSelectionMode}>Select items</Button
					>
				{/if}
				<span id={deferredCountId} class="sr-only"
					>{todoFilter.deferredCount} deferred Todo items match the current search and filters.</span
				>
				<Button
					variant="outline"
					size="sm"
					aria-label="Show deferred"
					aria-describedby={deferredCountId}
					class="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
					aria-pressed={todoFilter.showDeferred}
					disabled={workspace.isOperating || todoFilter.status === "completed"}
					onclick={() =>
						void workspace.setShowDeferred(!todoFilter.showDeferred).then((outcome) => {
							if (outcome.status !== "applied")
								toast.error("Could not save Show deferred", { description: outcome.message });
						})}>Show deferred ({todoFilter.deferredCount})</Button
				>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon"
								aria-label="Sort Todo items"
								title={`Sort: ${todoFilter.sortOrder === "file" ? "File order" : "Due date"}`}
								disabled={workspace.isOperating}
							>
								<ListFilter class="size-4" aria-hidden="true" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end">
						<DropdownMenu.Label>Sort Todo items</DropdownMenu.Label>
						<DropdownMenu.RadioGroup
							value={todoFilter.sortOrder}
							onValueChange={(value) => {
								if (
									!workspace.isOperating &&
									(value === "file" || value === "due") &&
									value !== todoFilter.sortOrder
								)
									void workspace.setSortOrder(value).then((outcome) => {
										if (outcome.status !== "applied")
											toast.error("Could not save sort order", { description: outcome.message });
									});
							}}
						>
							<DropdownMenu.RadioItem value="file">File order</DropdownMenu.RadioItem>
							<DropdownMenu.RadioItem value="due">Due date</DropdownMenu.RadioItem>
						</DropdownMenu.RadioGroup>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				<SavedViews {workspace} {todoFilter} />
				<Button
					bind:ref={searchButton}
					variant="ghost"
					size="icon"
					aria-label="Toggle Todo-item search"
					aria-expanded={searchOpen || todoFilter.hasSearch}
					aria-controls={searchId}
					disabled={workspace.isOperating}
					onclick={toggleSearch}
				>
					<Search class="size-4" aria-hidden="true" />
				</Button>
				{#if !bulkSelection.active}
					<TodoEditorDialog
						bind:open={creationOpen}
						todoFile={workspace.todoFile}
						saveTodoItem={workspace.createTodo}
						workspaceName={workspace.activeWorkspace?.name ?? ""}
						initialProject={todoFilter.selectedProject}
						initialContext={todoFilter.selectedContext}
						disabled={workspace.isOperating}
					/>
				{/if}
			</div>
		</div>
		{#if searchOpen || todoFilter.hasSearch}
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
	{#if workspace.todoFile}
		<WorkspaceTodoReader
			bind:this={reader}
			{workspace}
			{todoFilter}
			{filteredTodoItems}
			{bulkSelection}
		/>
	{:else}
		<div class="min-h-0 min-w-0 flex-1">
			<ScrollArea
				bind:viewportRef={emptyViewport}
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
			</ScrollArea>
		</div>
	{/if}
</div>
