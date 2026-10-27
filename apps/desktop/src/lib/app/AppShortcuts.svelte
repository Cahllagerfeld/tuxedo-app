<script lang="ts">
	import { tick } from "svelte";
	import { createHotkey, detectPlatform } from "@tanstack/svelte-hotkeys";
	import { getShortcutScope } from "#lib/shared/shortcuts/shortcut-scope.svelte.js";
	import { rowShortcuts, undoTodoShortcut } from "#lib/modules/todo/ui/shortcuts.js";
	import { searchShortcut, saveViewShortcut } from "#lib/modules/workspace/ui/shortcuts.js";
	import { bindings } from "./shortcut-bindings";
	import ShortcutHint from "#lib/shared/shortcuts/ShortcutHint.svelte";
	import * as Dialog from "#lib/shared/ui/dialog/index.js";
	import { Button } from "#lib/shared/ui/button/index.js";
	import { Input } from "#lib/shared/ui/input/index.js";
	import * as Kbd from "#lib/shared/ui/kbd/index.js";
	import SearchIcon from "@lucide/svelte/icons/search";
	import { useSidebar } from "#lib/shared/ui/sidebar/index.js";
	import type { AppState } from "./app-state.svelte";
	import type { WorkspaceUiState } from "#lib/modules/workspace/ui/workspace-ui-state.svelte.js";
	let {
		app,
		ui,
		readerShown,
		workspaceShown,
	}: { app: AppState; ui: WorkspaceUiState; readerShown: boolean; workspaceShown: boolean } =
		$props();
	const scope = getShortcutScope();
	const platform = detectPlatform();
	const sidebar = useSidebar();
	let helpOpen = $state(false);
	let query = $state("");
	const groups = [
		{
			title: "App & Workspaces",
			description: "Move around and manage your Workspaces.",
			shortcuts: [bindings.workspace, bindings.createWorkspace, bindings.sidebar, bindings.help],
		},
		{
			title: "Todo items & views",
			description: "Capture Todo items and find what you need.",
			shortcuts: [bindings.createTodo, searchShortcut, saveViewShortcut, undoTodoShortcut],
		},
		{
			title: "Row navigation & actions",
			description: "Available when a Todo-item row is focused.",
			shortcuts: Object.values(rowShortcuts),
		},
	];
	const filteredGroups = $derived(
		groups
			.map((group) => ({
				...group,
				shortcuts: group.shortcuts.filter((shortcut) =>
					`${group.title} ${shortcut.label} ${shortcut.key}`
						.toLowerCase()
						.includes(query.trim().toLowerCase())
				),
			}))
			.filter((group) => group.shortcuts.length > 0)
	);
	const idle = $derived(!app.isLoading && !app.workspace.isOperating);
	const actions = {
		workspace: async () => {
			if (sidebar.isMobile) sidebar.setOpenMobile(true);
			else sidebar.setOpen(true);
			await tick();
			ui.isWorkspaceSwitcherOpen = true;
		},
		createWorkspace: () => ui.openWorkspaceCreationDialog(),
		createTodo: () => {
			ui.isTodoCreationOpen = true;
		},
		help: () => {
			helpOpen = true;
		},
		sidebar: sidebar.toggle,
	};
	for (const id of Object.keys(bindings) as (keyof typeof bindings)[]) {
		createHotkey(
			bindings[id].key,
			(event) => {
				if (!event.repeat) void actions[id]();
			},
			() => ({
				enabled:
					(scope?.available ?? true) &&
					(id === "help" ||
						(id === "sidebar" && workspaceShown) ||
						(idle &&
							id !== "sidebar" &&
							(id !== "workspace" || workspaceShown) &&
							(id !== "createTodo" ||
								(readerShown && app.workspace.canMutate && !ui.bulkSelection.active)))),
				ignoreInputs: false,
				requireReset: true,
				platform,
			})
		);
	}
</script>

<Dialog.Root bind:open={helpOpen} onOpenChange={() => (query = "")}>
	<Dialog.Trigger
		>{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				class="mr-3 ml-auto [app-region:no-drag]"
				aria-label="Keyboard shortcuts">Shortcuts</Button
			>
		{/snippet}</Dialog.Trigger
	>
	<Dialog.Content
		class="max-h-[calc(100dvh-2rem)] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-xl"
	>
		<Dialog.Header class="px-6 pt-6 pb-5 text-left"
			><Dialog.Title class="text-lg">Keyboard shortcuts</Dialog.Title><Dialog.Description
				>Navigate Workspaces and Todo items with the keyboard.</Dialog.Description
			></Dialog.Header
		>
		<div class="px-6 pb-5">
			<div class="relative">
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					type="search"
					aria-label="Search shortcuts"
					placeholder="Search shortcuts…"
					bind:value={query}
					class="pl-9"
				/>
			</div>
		</div>
		<div
			class="min-h-0 overflow-y-auto overscroll-contain border-t px-6 py-5"
			aria-label="Shortcuts"
		>
			<div class="space-y-6">
				{#each filteredGroups as group (group.title)}
					<section>
						<h3 class="font-semibold text-foreground">{group.title}</h3>
						<p class="mt-1 text-xs text-muted-foreground">{group.description}</p>
						<dl class="mt-3 divide-y divide-border/50">
							{#each group.shortcuts as binding (binding.key)}
								<div class="flex items-center justify-between gap-6 py-2">
									<dt>{binding.label}</dt>
									<dd class="shrink-0"><ShortcutHint hotkey={binding.key} /></dd>
								</div>
							{/each}
						</dl>
					</section>
				{:else}
					<div role="status" class="py-10 text-center">
						<p class="font-medium">No shortcuts found</p>
						<p class="mt-1 text-sm text-muted-foreground">Try another action or key.</p>
					</div>
				{/each}
			</div>
		</div>
		<div class="border-t bg-muted/30 px-6 py-4 text-xs leading-relaxed text-muted-foreground">
			<Kbd.Root>Tab</Kbd.Root> reaches row controls. On the drag handle,
			<Kbd.Root>Space</Kbd.Root> and arrows reorder; <Kbd.Root>Esc</Kbd.Root> cancels.
		</div>
	</Dialog.Content>
</Dialog.Root>
