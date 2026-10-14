<script lang="ts">
	import { tick } from "svelte";
	import { MediaQuery } from "svelte/reactivity";
	import { getShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import type { TodoItem } from "$lib/modules/todo/domain/todo";
	import TodoList from "$lib/modules/todo/ui/TodoList.svelte";
	import TodoDetails from "$lib/modules/todo/ui/TodoDetails.svelte";
	import TodoEditorDialog from "$lib/modules/todo/ui/TodoEditorDialog.svelte";
	import type { TodoItemDraft, SaveTodoItemResult } from "$lib/modules/todo/ui/todo-editor-types";
	import type { TodoFilterState } from "$lib/modules/todo/state/todo-filter.svelte";
	import type { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";
	import * as Resizable from "$lib/shared/ui/resizable";
	import * as Sheet from "$lib/shared/ui/sheet";
	import * as Empty from "$lib/shared/ui/empty";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import { Button } from "$lib/shared/ui/button";
	import FileText from "@lucide/svelte/icons/file-text";
	import { toast } from "svelte-sonner";
	let {
		workspace,
		todoFilter,
		filteredTodoItems,
	}: {
		workspace: ElectronWorkspaceSessionState;
		todoFilter: TodoFilterState;
		filteredTodoItems: readonly TodoItem[];
	} = $props();
	const shortcutScope = getShortcutScope();
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

{#if workspace.todoFile}
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
{/if}

<div data-todo-reader class="min-h-0 min-w-0 flex-1">
	<Resizable.PaneGroup direction="horizontal">
		<Resizable.Pane defaultSize={58} minSize={35} class="flex min-h-0 flex-col">
			<div class="min-h-0 min-w-0 flex-1">
				<ScrollArea
					bind:viewportRef={todoViewport}
					class="h-full w-full"
					aria-label="Todo item results"
					viewportTabIndex={-1}
				>
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
					{/if}
				</ScrollArea>
			</div>
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
