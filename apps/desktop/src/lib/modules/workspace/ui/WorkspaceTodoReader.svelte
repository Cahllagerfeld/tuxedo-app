<script lang="ts">
	import { linear } from "svelte/easing";
	import { prefersReducedMotion } from "svelte/motion";
	import { MediaQuery } from "svelte/reactivity";
	import { getShortcutScope } from "#lib/shared/shortcuts/shortcut-scope.svelte.js";
	import type { TodoItem } from "#lib/modules/todo/domain/todo.js";
	import TodoList from "#lib/modules/todo/ui/TodoList.svelte";
	import TodoDetails from "#lib/modules/todo/ui/TodoDetails.svelte";
	import TodoEditorDialog from "#lib/modules/todo/ui/TodoEditorDialog.svelte";
	import { createTodoReaderInteraction } from "./todo-reader-interaction.svelte";
	import type { TodoFilterState } from "#lib/modules/todo/state/todo-filter.svelte.js";
	import type { WorkspaceCommands } from "../state/workspace-commands.svelte";
	import * as Resizable from "#lib/shared/ui/resizable/index.js";
	import * as Sheet from "#lib/shared/ui/sheet/index.js";
	import * as Empty from "#lib/shared/ui/empty/index.js";
	import { ScrollArea } from "#lib/shared/ui/scroll-area/index.js";
	import { Button } from "#lib/shared/ui/button/index.js";
	import FileText from "@lucide/svelte/icons/file-text";
	import { toast } from "svelte-sonner";
	import type { createTodoBulkSelection } from "./todo-bulk-selection.svelte";
	let {
		workspace,
		todoFilter,
		filteredTodoItems,
		bulkSelection,
	}: {
		workspace: WorkspaceCommands;
		todoFilter: TodoFilterState;
		filteredTodoItems: readonly TodoItem[];
		bulkSelection: ReturnType<typeof createTodoBulkSelection>;
	} = $props();
	const shortcutScope = getShortcutScope();
	const wide = new MediaQuery("(min-width: 1100px)");
	let todoList = $state<ReturnType<typeof TodoList>>();
	let todoViewport = $state<HTMLElement | null>(null);
	let desktopDetails = $state<HTMLElement | null>(null);
	const selectionMode = $derived(bulkSelection.active);
	const reader = createTodoReaderInteraction({
		get workspace() {
			return workspace;
		},
		get fileOrder() {
			return todoFilter.sortOrder === "file";
		},
		get wide() {
			return wide.current;
		},
		get list() {
			return todoList;
		},
		get viewport() {
			return todoViewport;
		},
		get details() {
			return desktopDetails;
		},
		shortcutScope,
	});
	export const closeDetails = () => reader.closeDetails();
	export const focusTodo = (todo: TodoItem) => todoList?.focusTodo(todo);
	function revealDetails(node: HTMLElement) {
		return () => {
			const grow = Number(getComputedStyle(node).flexGrow);
			const width = node.getBoundingClientRect().width;
			return {
				duration: prefersReducedMotion.current || !wide.current ? 0 : 200,
				easing: linear,
				// Keep text at its final width while the Pane reveals it.
				css: (t: number) => `flex-grow: ${grow * t}; --detail-width: ${width}px;`,
			};
		};
	}
	async function toggleTodoCompletion(todo: TodoItem) {
		const result = await reader.toggleCompletion(todo);
		if (result.status === "applied" && result.notice) toast.info(result.notice);
		if (result.status === "conflict")
			toast.error("Todo file changed", { description: result.message });
		else if (result.status === "rejected")
			toast.error("Could not update Todo item", { description: result.message });
	}
	async function deleteTodoItem(todo: TodoItem, trigger?: HTMLButtonElement | null) {
		const result = await reader.deleteTodo(todo, trigger);
		if (result.status === "applied" && result.notice) toast.info(result.notice);
		if (result.status === "conflict")
			toast.error("Todo file changed", { description: result.message });
		else if (result.status === "rejected")
			toast.error("Could not delete Todo item", { description: result.message });
	}
	async function reorderTodoItems(items: readonly TodoItem[]) {
		const result = await reader.reorder(items);
		if (result?.status === "applied" && result.notice) toast.info(result.notice);
		if (result?.status === "conflict")
			toast.error("Todo file changed", { description: result.message });
		else if (result?.status === "rejected")
			toast.error("Could not reorder Todo items", { description: result.message });
	}
</script>

<svelte:window onkeydown={reader.keydown} />

{#snippet details(todo: TodoItem, path: string)}
	<TodoDetails
		{todo}
		today={todoFilter.today}
		{path}
		disabled={workspace.writesBlocked}
		onClose={reader.closeDetails}
		onEdit={reader.startEdit}
		onToggleComplete={toggleTodoCompletion}
		onDelete={deleteTodoItem}
	/>
{/snippet}

{#if workspace.todoFile}
	{#key workspace.activeWorkspace?.id + ":" + workspace.todoFile.path}
		{#if reader.editingTodo && !selectionMode}
			<TodoEditorDialog
				todoFile={workspace.todoFile}
				todoToEdit={reader.editingTodo}
				saveTodoItem={reader.saveEdit}
				workspaceName={workspace.activeWorkspace?.name ?? ""}
				showDeferred={todoFilter.showDeferred}
				disabled={workspace.writesBlocked}
				dismissalBlocked={workspace.isOperating}
				onClose={reader.closeEdit}
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
								{#if !todoFilter.showDeferred && todoFilter.deferredCount > 0}
									<Empty.Header>
										<Empty.Title>Matching Todo items are deferred</Empty.Title>
										<Empty.Description>
											{todoFilter.deferredCount} matching {todoFilter.deferredCount === 1
												? "Todo item is"
												: "Todo items are"} deferred until a future Show from date.
										</Empty.Description>
									</Empty.Header>
									<Button
										disabled={workspace.writesBlocked}
										onclick={() =>
											void workspace.setShowDeferred(true).then((outcome) => {
												if (outcome.status === "applied") {
													if (outcome.notice) toast.info(outcome.notice);
												} else
													toast.error("Could not save Show deferred", {
														description: outcome.message,
													});
											})}>Show deferred</Button
									>
								{:else}
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
										<Button disabled={workspace.writesBlocked} onclick={todoFilter.clear}
											>Clear filters</Button
										>
									{/if}
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
							disabled={workspace.writesBlocked}
							onToggleComplete={selectionMode ? () => {} : toggleTodoCompletion}
							onDelete={selectionMode ? () => {} : deleteTodoItem}
							onEdit={selectionMode ? undefined : reader.startEdit}
							onReorder={selectionMode || todoFilter.sortOrder !== "file"
								? undefined
								: reorderTodoItems}
							selectedTodo={selectionMode ? null : reader.selectedTodo}
							onSelect={selectionMode ? undefined : reader.select}
							onNavigate={selectionMode ? undefined : reader.navigate}
							{selectionMode}
							isSelected={bulkSelection.isSelected}
							onToggleSelect={bulkSelection.toggle}
							onSelectAll={bulkSelection.selectAll}
						/>
					{/if}
				</ScrollArea>
			</div>
		</Resizable.Pane>
		{#if !selectionMode && reader.selectedTodo && wide.current && workspace.todoFile}
			{@const todo = reader.selectedTodo}
			{@const path = workspace.todoFile.path}
			<Resizable.Handle aria-label="Resize Todo item details" />
			<Resizable.Pane defaultSize={42} minSize={35} maxSize={65}>
				{#snippet child({ props })}
					<div {...props} transition:revealDetails|global>
						<aside
							bind:this={desktopDetails}
							aria-label="Todo item details"
							class="h-full w-[var(--detail-width,100%)]"
						>
							{@render details(todo, path)}
						</aside>
					</div>
				{/snippet}
			</Resizable.Pane>
		{/if}
	</Resizable.PaneGroup>
</div>
{#if !wide.current}
	<Sheet.Root
		open={!selectionMode && !!reader.selectedTodo}
		onOpenChange={(open) => {
			if (!open) reader.closeDetails();
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
			{#if reader.selectedTodo && workspace.todoFile}
				{@render details(reader.selectedTodo, workspace.todoFile.path)}
			{/if}
		</Sheet.Content>
	</Sheet.Root>
{/if}
