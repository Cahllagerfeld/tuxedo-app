<script lang="ts">
	import { tick } from "svelte";
	import { createHotkey, detectPlatform } from "@tanstack/svelte-hotkeys";
	import { getShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import { rowShortcuts } from "$lib/modules/todo/ui/shortcuts";
	import { searchShortcut, saveViewShortcut } from "$lib/modules/workspace/ui/shortcuts";
	import { bindings } from "./shortcut-bindings";
	import ShortcutHint from "$lib/shared/shortcuts/ShortcutHint.svelte";
	import * as Dialog from "$lib/shared/ui/dialog";
	import { Button } from "$lib/shared/ui/button";
	import { useSidebar } from "$lib/shared/ui/sidebar";
	import type { AppState } from "./app-state.svelte";
	let { app }: { app: AppState } = $props();
	const scope = getShortcutScope();
	const platform = detectPlatform();
	const sidebar = useSidebar();
	let helpOpen = $state(false);
	const idle = $derived(!app.workspace.isLoading && !app.workspace.isOperating);
	const actions = {
		workspace: async () => {
			if (sidebar.isMobile) sidebar.setOpenMobile(true);
			else sidebar.setOpen(true);
			await tick();
			app.isWorkspaceSwitcherOpen = true;
		},
		createWorkspace: () => app.openWorkspaceCreationDialog(),
		createTodo: () => {
			app.isTodoCreationOpen = true;
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
						id === "sidebar" ||
						(idle && (id !== "createTodo" || !!app.workspace.todoFile))),
				ignoreInputs: false,
				requireReset: true,
				platform,
			})
		);
	}
</script>

<Dialog.Root bind:open={helpOpen}>
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
	<Dialog.Content class="max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto">
		<Dialog.Header
			><Dialog.Title>Keyboard shortcuts</Dialog.Title><Dialog.Description
				>Navigate Workspaces and Todo items with the keyboard.</Dialog.Description
			></Dialog.Header
		>
		{#each Object.values(bindings) as binding (binding.key)}
			<div class="flex items-center justify-between gap-4">
				<span>{binding.label}</span><ShortcutHint hotkey={binding.key} />
			</div>
		{/each}
		{#each [searchShortcut, saveViewShortcut] as binding (binding.key)}
			<div class="flex items-center justify-between gap-4">
				<span>{binding.label}</span><ShortcutHint hotkey={binding.key} />
			</div>
		{/each}
		<p class="text-sm font-medium">On a focused Todo-item row</p>
		{#each Object.values(rowShortcuts) as binding (binding.key)}
			<div class="flex items-center justify-between gap-4">
				<span>{binding.label}</span><ShortcutHint hotkey={binding.key} />
			</div>
		{/each}
		<p class="text-sm text-muted-foreground">
			Tab reaches row controls. On the drag handle, Space and arrows reorder; Escape cancels.
		</p>
	</Dialog.Content>
</Dialog.Root>
