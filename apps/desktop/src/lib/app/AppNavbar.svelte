<script lang="ts">
	import * as Sidebar from "#lib/shared/ui/sidebar/index.js";
	import AppShortcuts from "./AppShortcuts.svelte";
	import type { AppState } from "./app-state.svelte";
	import type { WorkspaceUiState } from "#lib/modules/workspace/ui/workspace-ui-state.svelte.js";
	import { Button } from "#lib/shared/ui/button/index.js";
	import Undo2 from "@lucide/svelte/icons/undo-2";
	import { toast } from "svelte-sonner";
	import { createHotkey, formatForDisplay } from "@tanstack/svelte-hotkeys";
	import { getShortcutScope } from "#lib/shared/shortcuts/shortcut-scope.svelte.js";
	import { undoTodoShortcut } from "#lib/modules/todo/ui/shortcuts.js";
	let {
		app,
		ui,
		readerShown = true,
		workspaceShown = readerShown,
	}: {
		app: AppState;
		ui: WorkspaceUiState;
		readerShown?: boolean;
		workspaceShown?: boolean;
	} = $props();
	const shortcutScope = getShortcutScope();
	const canUndo = $derived(
		readerShown && !!app.undoLabel && app.workspace.canMutate && !ui.bulkSelection.active
	);
	async function undo() {
		if (!canUndo) return;
		const outcome = await app.workspace.undoTodo();
		if (outcome.status === "applied" && outcome.notice) toast.info(outcome.notice);
		if (outcome.status === "conflict") toast.warning(outcome.message);
		else if (outcome.status === "rejected") toast.error(outcome.message);
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
			aria-label={app.undoLabel ?? "Undo last change"}
			title={`${app.undoLabel ?? "Undo last change"} (${formatForDisplay(undoTodoShortcut.key)})`}
			disabled={!canUndo}
			onclick={undo}><Undo2 aria-hidden="true" /></Button
		>
	{:else}
		<span class="pl-2 text-xs font-semibold tracking-wide">Tuxedo</span>
	{/if}
	<AppShortcuts {app} {ui} {readerShown} {workspaceShown} />
</header>
