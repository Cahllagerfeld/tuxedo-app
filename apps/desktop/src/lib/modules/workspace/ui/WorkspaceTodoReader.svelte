<script lang="ts">
	import { linear } from "svelte/easing";
	import { prefersReducedMotion } from "svelte/motion";
	import { MediaQuery } from "svelte/reactivity";
	import type { Snippet } from "svelte";
	import { getShortcutScope } from "#lib/shared/shortcuts/shortcut-scope.svelte.js";
	import type { TodoItem } from "#lib/modules/todo/domain/todo.js";
	import type { BoardDestination } from "@tuxedo/contracts/board";
	import type TodoList from "#lib/modules/todo/ui/TodoList.svelte";
	import TodoDetails from "#lib/modules/todo/ui/TodoDetails.svelte";
	import TodoEditorDialog from "#lib/modules/todo/ui/TodoEditorDialog.svelte";
	import { createTodoReaderInteraction } from "./todo-reader-interaction.svelte";
	import type { TodoFilterState } from "#lib/modules/todo/state/todo-filter.svelte.js";
	import type { WorkspaceCommands } from "../state/workspace-commands.svelte";
	import type { WorkspaceView } from "../state/workspace-view.js";
	import type { WorkspaceViewMode } from "../domain/workspace.js";
	import { setWorkspaceTodoReader } from "./workspace-todo-reader-context.js";
	import * as Resizable from "#lib/shared/ui/resizable/index.js";
	import * as Sheet from "#lib/shared/ui/sheet/index.js";
	import { toast } from "svelte-sonner";
	import type { createTodoBulkSelection } from "./todo-bulk-selection.svelte";
	let {
		children,
		viewMode = "list",
		workspace,
		view,
		todoFilter,
		filteredTodoItems,
		bulkSelection,
		onCreate,
	}: {
		children: Snippet;
		viewMode?: WorkspaceViewMode;
		workspace: WorkspaceCommands;
		view: WorkspaceView;
		todoFilter: TodoFilterState;
		filteredTodoItems: readonly TodoItem[];
		bulkSelection: ReturnType<typeof createTodoBulkSelection>;
		onCreate: () => void;
	} = $props();
	const shortcutScope = getShortcutScope();
	const wide = new MediaQuery("(min-width: 1100px)");
	let surface = $state<ReturnType<typeof TodoList>>();
	let viewport = $state<HTMLElement | null>(null);
	let desktopDetails = $state<HTMLElement | null>(null);
	const selectionMode = $derived(viewMode === "list" && bulkSelection.active);
	const reader = createTodoReaderInteraction({
		get view() {
			return view;
		},
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
			return surface;
		},
		get viewport() {
			return viewport;
		},
		get details() {
			return desktopDetails;
		},
		shortcutScope,
	});
	export const closeDetails = () => reader.closeDetails();
	export const focusTodo = (todo: TodoItem) => surface?.focusTodo(todo);
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
	async function moveTodoOnBoard(
		todo: TodoItem,
		column: BoardDestination,
		trigger?: HTMLElement | null
	) {
		const result = await reader.moveOnBoard(todo, column, trigger);
		if (result.status === "applied" && result.notice) toast.info(result.notice);
		if (
			result.status === "applied" &&
			!filteredTodoItems.some((item) => item.line_number === todo.line_number)
		) {
			const moved = workspace.confirmed;
			toast.success(column === "done" ? "Todo item completed" : "Todo item moved", {
				description: `${todo.description} no longer matches the current filters.`,
				action: {
					label: "Undo",
					onClick: async () => {
						// Undo only this move; a later change owns the single Undo slot.
						if (workspace.confirmed !== moved || !workspace.canMutate)
							return toast.error("Undo is no longer available for this move.");
						const outcome = await workspace.undoTodo();
						if (outcome.status === "applied" && outcome.notice) toast.info(outcome.notice);
						if (outcome.status === "conflict") toast.warning(outcome.message);
						else if (outcome.status === "rejected") toast.error(outcome.message);
					},
				},
			});
		}
		if (result.status === "conflict")
			toast.error("Todo file changed", { description: result.message });
		else if (result.status === "rejected")
			toast.error("Could not move Todo item", { description: result.message });
	}
	setWorkspaceTodoReader({
		get workspace() {
			return workspace;
		},
		get view() {
			return view;
		},
		get todoFilter() {
			return todoFilter;
		},
		get filteredTodoItems() {
			return filteredTodoItems;
		},
		get bulkSelection() {
			return bulkSelection;
		},
		get selectionMode() {
			return selectionMode;
		},
		reader,
		get surface() {
			return surface;
		},
		set surface(value) {
			surface = value;
		},
		get viewport() {
			return viewport;
		},
		set viewport(value) {
			viewport = value;
		},
		onCreate: () => onCreate(),
		toggleTodoCompletion,
		deleteTodoItem,
		reorderTodoItems,
		moveTodoOnBoard,
	});
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

{#if view.todoFile}
	{#key view.activeWorkspace?.id + ":" + view.todoFile.path}
		{#if reader.editingTodo && !selectionMode}
			<TodoEditorDialog
				todoFile={view.todoFile}
				todoToEdit={reader.editingTodo}
				saveTodoItem={reader.saveEdit}
				workspaceName={view.activeWorkspace?.name ?? ""}
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
				{@render children()}
			</div>
		</Resizable.Pane>
		{#if !selectionMode && reader.selectedTodo && wide.current && view.todoFile}
			{@const todo = reader.selectedTodo}
			{@const path = view.todoFile.path}
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
			{#if reader.selectedTodo && view.todoFile}
				{@render details(reader.selectedTodo, view.todoFile.path)}
			{/if}
		</Sheet.Content>
	</Sheet.Root>
{/if}
