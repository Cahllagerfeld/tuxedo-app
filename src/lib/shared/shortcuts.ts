import { detectPlatform, type Hotkey } from "@tanstack/svelte-hotkeys";

export const shortcutPlatform = detectPlatform();
export const shortcuts = {
	workspaceSwitcher: { label: "Open Workspace switcher", binding: "Mod+P" },
	workspaceCreation: { label: "Create Workspace", binding: "Mod+Shift+N" },
	help: { label: "Keyboard shortcuts", binding: "Mod+/" },
	previous: { label: "Previous Todo item", binding: "ArrowUp" },
	next: { label: "Next Todo item", binding: "ArrowDown" },
	first: { label: "First Todo item", binding: "Home" },
	last: { label: "Last Todo item", binding: "End" },
	completion: { label: "Toggle Todo-item completion", binding: "Space" },
} as const satisfies Record<string, { label: string; binding: Hotkey }>;

// Bits UI owns popup lifecycle and focus traps; inspect its mounted surfaces at key time.
export function shortcutSurfaceOpen() {
	return (
		document.querySelector(
			'[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"]), [role="menu"]:not([data-state="closed"])'
		) !== null
	);
}
