<script lang="ts">
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import AppShortcuts from "./AppShortcuts.svelte";
	import type { WorkspaceCommands } from "$lib/modules/workspace/state/workspace-commands.svelte";
	import type { WorkspaceData } from "$lib/modules/workspace/state/workspace-data.svelte";
	import { Button } from "$lib/shared/ui/button";
	import Undo2 from "@lucide/svelte/icons/undo-2";
	import { toast } from "svelte-sonner";
	import { createHotkey, formatForDisplay } from "@tanstack/svelte-hotkeys";
	import { getShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import { undoTodoShortcut } from "$lib/modules/todo/ui/shortcuts";
	let {
		workspace,
		commands,
		bulkSelectionActive,
		openWorkspaceSwitcher,
		openWorkspaceCreationDialog,
		openTodoCreation,
		readerShown = true,
		workspaceShown = readerShown,
	}: {
		workspace: WorkspaceData;
		commands: WorkspaceCommands;
		bulkSelectionActive: boolean;
		openWorkspaceSwitcher: () => void;
		openWorkspaceCreationDialog: () => void;
		openTodoCreation: () => void;
		readerShown?: boolean;
		workspaceShown?: boolean;
	} = $props();
	const shortcutScope = getShortcutScope();
	const canUndo = $derived(
		readerShown && !!workspace.undoLabel && !commands.isOperating && !bulkSelectionActive
	);
	async function undo() {
		if (!canUndo) return;
		const outcome = await commands.undoTodo();
		if (outcome.status === "conflict") toast.warning(outcome.message);
		else if (outcome.status === "rejected") toast.error(outcome.message);
		else if (outcome.notice) toast.info(outcome.notice);
	}
	createHotkey(
		undoTodoShortcut.key,
		() => void undo(),
		() => ({
			enabled: (shortcutScope?.available ?? true) && canUndo,
			ignoreInputs: true,
			preventDefault: true,
			requireReset: true,
		})
	);
</script>

<header
	class="flex h-(--window-toolbar-height) shrink-0 items-center bg-window-background pl-24 text-sm font-medium text-muted-foreground select-none [app-region:drag]"
>
	{#if workspaceShown}
		<Sidebar.Trigger class="[app-region:no-drag]" />
		<Button
			variant="ghost"
			size="icon-sm"
			class="[app-region:no-drag]"
			aria-label={workspace.undoLabel ?? "Undo last change"}
			title={`${workspace.undoLabel ?? "Undo last change"} (${formatForDisplay(undoTodoShortcut.key)})`}
			disabled={!canUndo}
			onclick={undo}><Undo2 aria-hidden="true" /></Button
		>
	{:else}
		<span class="pl-2 text-xs font-semibold tracking-wide">Tuxedo</span>
	{/if}
	<AppShortcuts
		{workspace}
		{commands}
		{bulkSelectionActive}
		{readerShown}
		{workspaceShown}
		{openWorkspaceSwitcher}
		{openWorkspaceCreationDialog}
		{openTodoCreation}
	/>
</header>
