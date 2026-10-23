<script lang="ts">
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import AppShortcuts from "./AppShortcuts.svelte";
	import type { AppState } from "./app-state.svelte";
	import { Button } from "$lib/shared/ui/button";
	import Undo2 from "@lucide/svelte/icons/undo-2";
	import { toast } from "svelte-sonner";
	import { createHotkey, formatForDisplay } from "@tanstack/svelte-hotkeys";
	import { getShortcutScope } from "$lib/shared/shortcuts/shortcut-scope.svelte";
	import { undoTodoShortcut } from "$lib/modules/todo/ui/shortcuts";
	let {
		app,
		readerShown = true,
		workspaceShown = readerShown,
	}: { app: AppState; readerShown?: boolean; workspaceShown?: boolean } = $props();
	const shortcutScope = getShortcutScope();
	const canUndo = $derived(
		readerShown &&
			!!app.workspace.undoLabel &&
			app.workspace.canMutate &&
			!app.todoBulkSelectionActive
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
			aria-label={app.workspace.undoLabel ?? "Undo last change"}
			title={`${app.workspace.undoLabel ?? "Undo last change"} (${formatForDisplay(undoTodoShortcut.key)})`}
			disabled={!canUndo}
			onclick={undo}><Undo2 aria-hidden="true" /></Button
		>
	{:else}
		<span class="pl-2 text-xs font-semibold tracking-wide">Tuxedo</span>
	{/if}
	<AppShortcuts {app} {readerShown} {workspaceShown} />
</header>
