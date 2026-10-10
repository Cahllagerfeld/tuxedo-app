import type { Hotkey } from "@tanstack/svelte-hotkeys";
import { workspaceShortcuts } from "$lib/modules/workspace/ui/workspace-shortcuts";
import { todoShortcuts } from "$lib/modules/todo/ui/todo-shortcuts";

export const shortcuts = {
	...workspaceShortcuts,
	help: { label: "Keyboard shortcuts", binding: "Mod+/" },
	...todoShortcuts,
} as const satisfies Record<string, { label: string; binding: Hotkey }>;
