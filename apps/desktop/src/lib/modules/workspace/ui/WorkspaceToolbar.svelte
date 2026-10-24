<script lang="ts">
	import { tick } from "svelte";
	import { mergeProps } from "bits-ui";
	import ShortcutHint from "#lib/shared/shortcuts/ShortcutHint.svelte";
	import { createHotkey } from "@tanstack/svelte-hotkeys";
	import { getShortcutScope } from "#lib/shared/shortcuts/shortcut-scope.svelte.js";
	import type { TodoItem } from "#lib/modules/todo/domain/todo.js";
	import TodoEditorDialog from "#lib/modules/todo/ui/TodoEditorDialog.svelte";
	import ActiveTodoFilters from "#lib/modules/todo/ui/ActiveTodoFilters.svelte";
	import * as AlertDialog from "#lib/shared/ui/alert-dialog/index.js";
	import { Button } from "#lib/shared/ui/button/index.js";
	import * as ButtonGroup from "#lib/shared/ui/button-group/index.js";
	import * as Tooltip from "#lib/shared/ui/tooltip/index.js";
	import ListChecks from "@lucide/svelte/icons/list-checks";
	import Clock from "@lucide/svelte/icons/clock";
	import Check from "@lucide/svelte/icons/check";
	import * as DropdownMenu from "#lib/shared/ui/dropdown-menu/index.js";
	import { Input } from "#lib/shared/ui/input/index.js";
	import SavedViews from "./SavedViews.svelte";
	import Search from "@lucide/svelte/icons/search";
	import ListFilter from "@lucide/svelte/icons/list-filter";
	import { toast } from "svelte-sonner";
	import X from "@lucide/svelte/icons/x";
	import type { WorkspaceCommands } from "../state/workspace-commands.svelte";
	import type { TodoFilterState } from "#lib/modules/todo/state/todo-filter.svelte.js";
	import { searchShortcut } from "./shortcuts";
	import { createTodoBulkSelection } from "./todo-bulk-selection.svelte";

	type Props = {
		creationOpen?: boolean;
		bulkSelection: ReturnType<typeof createTodoBulkSelection>;
		workspace: WorkspaceCommands;
		todoFilter: TodoFilterState;
		filteredTodoItems: readonly TodoItem[];
		closeDetails: () => void;
		focusTodo: (todo: TodoItem) => void;
	};

	let {
		creationOpen = $bindable(false),
		bulkSelection,
		workspace,
		todoFilter,
		filteredTodoItems,
		closeDetails,
		focusTodo,
	}: Props = $props();
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
	let deleteButton = $state<HTMLButtonElement | null>(null);
	let doneButton = $state<HTMLButtonElement | null>(null);
	const deleting = $derived(bulkSelection.deleting);
	const deleteOpen = $derived(!!bulkSelection.deletionItems);
	let deletionError = $state<string | null>(null);
	let deletionFocus: { scope: symbol; index: number } | null = null;
	let deleteScope: symbol | undefined;
	function openDeleteConfirmation() {
		deletionError = null;
		deleteScope = bulkSelection.scope;
		bulkSelection.openDeletion();
	}
	async function deleteSelected() {
		await bulkSelection.deleteConfirmed(async (items) => {
			const scope = bulkSelection.scope;
			const position = filteredTodoItems.findIndex(
				(todo) => todo.line_number === items[0].line_number && todo.raw === items[0].raw
			);
			deletionError = null;
			const result = await workspace.bulkDeleteTodos(items);
			if (result.status === "applied") {
				toast.success(`Deleted ${items.length} ${items.length === 1 ? "Todo item" : "Todo items"}`);
				if (result.notice) toast.info(result.notice);
				deletionFocus = { scope, index: position };
			} else if (result.status === "conflict") {
				toast.error("Todo file changed", { description: result.message });
			} else {
				deletionError = result.message;
				toast.error("Could not delete Todo items", { description: result.message });
			}
			return result;
		});
	}
	function restoreDeleteFocus(event: Event) {
		event.preventDefault();
		const target = deletionFocus;
		deletionFocus = null;
		bulkSelection.cancelDeletion();
		const scope = target?.scope ?? deleteScope;
		void tick().then(() => {
			if (scope !== bulkSelection.scope || !bulkSelection.active) return;
			if (!target) (deleteButton?.disabled ? doneButton : deleteButton)?.focus();
			else {
				const todo = filteredTodoItems[Math.min(target.index, filteredTodoItems.length - 1)];
				if (todo) focusTodo(todo);
				else doneButton?.focus();
			}
		});
	}
	async function setSelectedCompletion(completed: boolean) {
		if (workspace.writesBlocked) return;
		const items = [...bulkSelection.selectedItems];
		const count = items.filter((todo) => todo.completed !== completed).length;
		if (!count) return;
		const scope = bulkSelection.scope;
		const position = filteredTodoItems.indexOf(items[0]);
		const origin = document.activeElement;
		const result = await bulkSelection.changeSelected((targets) =>
			workspace.bulkSetCompletion(targets, completed)
		);
		if (result.status === "applied") {
			toast.success(
				completed
					? `Completed ${count} ${count === 1 ? "Todo item" : "Todo items"}`
					: `Marked ${count} ${count === 1 ? "Todo item" : "Todo items"} incomplete`
			);
			if (result.notice) toast.info(result.notice);
		} else if (result.status === "conflict") {
			toast.error("Todo file changed", { description: result.message });
		} else
			toast.error(
				completed ? "Could not complete Todo items" : "Could not mark Todo items incomplete",
				{
					description: result.message,
				}
			);
		if (result.status === "applied" || result.status === "conflict") {
			await tick();
			if (scope !== bulkSelection.scope || !bulkSelection.active) return;
			const focused = document.activeElement;
			if (
				focused !== origin &&
				focused instanceof HTMLElement &&
				focused !== document.body &&
				focused.isConnected &&
				!focused.matches(":disabled") &&
				!focused.closest("[inert], [hidden]")
			)
				return;
			const todo = filteredTodoItems[Math.min(position, filteredTodoItems.length - 1)];
			if (todo) focusTodo(todo);
			else doneButton?.focus();
		}
	}
	function enterSelectionMode() {
		closeDetails();
		bulkSelection.enter();
	}
	createHotkey(
		"Escape",
		() => bulkSelection.exit(),
		() => ({
			enabled:
				bulkSelection.active &&
				!deleteOpen &&
				!workspace.writesBlocked &&
				(shortcutScope?.available ?? true),
			ignoreInputs: true,
			preventDefault: true,
		})
	);
	createHotkey(searchShortcut.key, toggleSearch, () => ({
		enabled: (shortcutScope?.available ?? true) && !!workspace.todoFile && !workspace.writesBlocked,
		ignoreInputs: false,
		preventDefault: true,
		requireReset: true,
	}));
</script>

<AlertDialog.Root
	open={deleteOpen}
	onOpenChange={(open) => {
		if (!open) bulkSelection.cancelDeletion();
	}}
>
	<AlertDialog.Content
		onEscapeKeydown={(event) => {
			if (workspace.isOperating || deleting) event.preventDefault();
		}}
		onCloseAutoFocus={restoreDeleteFocus}
	>
		<AlertDialog.Header>
			<AlertDialog.Title>
				Delete {bulkSelection.deletionItems?.length ?? 0}
				{bulkSelection.deletionItems?.length === 1 ? "Todo item" : "Todo items"}?
			</AlertDialog.Title>
			<AlertDialog.Description>
				The selected Todo items will be deleted from the Todo file. After leaving selection mode,
				you can undo this deletion with Undo last change.
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if deletionError}
			<p role="alert" class="text-sm text-destructive">{deletionError}</p>
		{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={workspace.isOperating || deleting}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				disabled={workspace.writesBlocked || deleting}
				onclick={deleteSelected}
			>
				{deleting ? "Deleting…" : "Delete Todo items"}
			</AlertDialog.Action>
		</AlertDialog.Footer>
		{#if deleting}
			<p role="status" class="text-sm text-muted-foreground">Deleting selected Todo items…</p>
		{/if}
	</AlertDialog.Content>
</AlertDialog.Root>

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
				<ButtonGroup.Root aria-label="Selection controls">
					<Tooltip.Provider>
						<Tooltip.Root disableHoverableContent>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="outline"
										size="sm"
										disabled={workspace.writesBlocked || filteredTodoItems.length === 0}
										onclick={bulkSelection.selectAll}>Select all</Button
									>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>Select all matching Todo items</Tooltip.Content>
						</Tooltip.Root>
					</Tooltip.Provider>
					<Tooltip.Provider>
						<Tooltip.Root disableHoverableContent>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="outline"
										size="sm"
										disabled={workspace.writesBlocked || bulkSelection.count === 0}
										onclick={bulkSelection.clear}>Clear selection</Button
									>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>Clear selection</Tooltip.Content>
						</Tooltip.Root>
					</Tooltip.Provider>
				</ButtonGroup.Root>
				<Tooltip.Provider>
					<Tooltip.Root disableHoverableContent>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									size="sm"
									disabled={workspace.writesBlocked || bulkSelection.selectedOpenCount === 0}
									onclick={() => void setSelectedCompletion(true)}
								>
									<Check aria-hidden="true" />Complete</Button
								>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>Complete selected Todo items</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
				<Tooltip.Provider>
					<Tooltip.Root disableHoverableContent>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="outline"
									size="sm"
									disabled={workspace.writesBlocked || bulkSelection.selectedCompletedCount === 0}
									onclick={() => void setSelectedCompletion(false)}>Mark incomplete</Button
								>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>Mark selected Todo items incomplete</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
				<Tooltip.Provider>
					<Tooltip.Root disableHoverableContent>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									bind:ref={deleteButton}
									variant="destructive"
									size="sm"
									disabled={workspace.writesBlocked || bulkSelection.count === 0}
									onclick={openDeleteConfirmation}>Delete</Button
								>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>Delete selected Todo items</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
				<Tooltip.Provider>
					<Tooltip.Root disableHoverableContent>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="ghost"
									size="icon-sm"
									bind:ref={doneButton}
									aria-label="Exit selection mode"
									disabled={workspace.writesBlocked}
									onclick={bulkSelection.exit}
								>
									<X aria-hidden="true" />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>Exit selection mode (Esc)</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
			{:else}
				<Tooltip.Provider>
					<Tooltip.Root disableHoverableContent>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="ghost"
									size="icon-sm"
									aria-label="Select items"
									disabled={workspace.writesBlocked}
									onclick={enterSelectionMode}
								>
									<ListChecks aria-hidden="true" />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>Select items</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
			{/if}
			<span id={deferredCountId} class="sr-only"
				>{todoFilter.deferredCount} deferred Todo items match the current search and filters.</span
			>
			<Tooltip.Provider>
				<Tooltip.Root disableHoverableContent>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-sm"
								aria-label="Show deferred"
								aria-describedby={deferredCountId}
								class="relative aria-pressed:bg-accent aria-pressed:text-accent-foreground"
								aria-pressed={todoFilter.showDeferred}
								disabled={workspace.writesBlocked || todoFilter.status === "completed"}
								onclick={() =>
									void workspace.setShowDeferred(!todoFilter.showDeferred).then((outcome) => {
										if (outcome.status === "applied") {
											if (outcome.notice) toast.info(outcome.notice);
										} else
											toast.error("Could not save Show deferred", {
												description: outcome.message,
											});
									})}
							>
								<Clock aria-hidden="true" />
								{#if todoFilter.deferredCount > 0}
									<span
										aria-hidden="true"
										class="absolute -top-1 -right-1 rounded-full bg-muted px-1 text-[10px] leading-4 text-muted-foreground tabular-nums"
										>{todoFilter.deferredCount}</span
									>
								{/if}
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content
						>{todoFilter.showDeferred ? "Hide deferred" : "Show deferred"} ({todoFilter.deferredCount})</Tooltip.Content
					>
				</Tooltip.Root>
			</Tooltip.Provider>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props: menuProps })}
						<Tooltip.Provider>
							<Tooltip.Root disableHoverableContent>
								<Tooltip.Trigger>
									{#snippet child({ props: tooltipProps })}
										<Button
											{...mergeProps(menuProps, tooltipProps)}
											variant="ghost"
											size="icon-sm"
											aria-label="Sort Todo items"
											title={`Sort: ${todoFilter.sortOrder === "file" ? "File order" : "Due date"}`}
											disabled={workspace.writesBlocked}
										>
											<ListFilter class="size-4" aria-hidden="true" />
										</Button>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content
									>Sort: {todoFilter.sortOrder === "file"
										? "File order"
										: "Due date"}</Tooltip.Content
								>
							</Tooltip.Root>
						</Tooltip.Provider>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end">
					<DropdownMenu.Label>Sort Todo items</DropdownMenu.Label>
					<DropdownMenu.RadioGroup
						value={todoFilter.sortOrder}
						onValueChange={(value) => {
							if (
								!workspace.writesBlocked &&
								(value === "file" || value === "due") &&
								value !== todoFilter.sortOrder
							)
								void workspace.setSortOrder(value).then((outcome) => {
									if (outcome.status === "applied") {
										if (outcome.notice) toast.info(outcome.notice);
									} else toast.error("Could not save sort order", { description: outcome.message });
								});
						}}
					>
						<DropdownMenu.RadioItem value="file">File order</DropdownMenu.RadioItem>
						<DropdownMenu.RadioItem value="due">Due date</DropdownMenu.RadioItem>
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<SavedViews {workspace} {todoFilter} />
			<Tooltip.Provider>
				<Tooltip.Root disableHoverableContent>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								bind:ref={searchButton}
								variant="ghost"
								size="icon-sm"
								aria-label="Toggle Todo-item search"
								aria-expanded={searchOpen || todoFilter.hasSearch}
								aria-controls={searchId}
								disabled={workspace.writesBlocked}
								onclick={toggleSearch}
							>
								<Search class="size-4" aria-hidden="true" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content
						>Search Todo items <ShortcutHint hotkey={searchShortcut.key} />
					</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
			{#if !bulkSelection.active}
				<TodoEditorDialog
					bind:open={creationOpen}
					todoFile={workspace.todoFile}
					saveTodoItem={workspace.createTodo}
					workspaceName={workspace.activeWorkspace?.name ?? ""}
					showDeferred={todoFilter.showDeferred}
					initialProject={todoFilter.selectedProject}
					initialContext={todoFilter.selectedContext}
					disabled={workspace.writesBlocked}
					dismissalBlocked={workspace.isOperating}
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
					disabled={workspace.writesBlocked}
					class="pr-9 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
				/>
				{#if todoFilter.searchText}
					<Tooltip.Provider>
						<Tooltip.Root disableHoverableContent>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="ghost"
										size="icon-xs"
										class="absolute top-1 right-1"
										aria-label="Clear search"
										disabled={workspace.writesBlocked}
										onclick={todoFilter.clearSearch}
									>
										<X class="size-4" aria-hidden="true" />
									</Button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>Clear search</Tooltip.Content>
						</Tooltip.Root>
					</Tooltip.Provider>
				{/if}
			</div>
		</div>
	{/if}
	<ActiveTodoFilters {todoFilter} disabled={workspace.writesBlocked} />
{/if}
