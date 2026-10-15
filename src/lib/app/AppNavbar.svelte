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
	let { app }: { app: AppState } = $props();
	const shortcutScope = getShortcutScope();
	const canUndo = $derived(!!app.workspace.undoLabel && !app.workspace.isOperating);
	async function undo() {
		if (!canUndo) return;
		const outcome = await app.workspace.undoTodo();
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
	class="flex h-(--window-toolbar-height) shrink-0 items-center gap-2 bg-window-background pl-24 text-sm font-medium text-muted-foreground select-none [app-region:drag]"
>
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
	<AppShortcuts {app} />
</header>
