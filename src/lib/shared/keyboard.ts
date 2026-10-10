import { detectPlatform } from "@tanstack/svelte-hotkeys";

export const shortcutPlatform = detectPlatform();

// Bits UI owns popup lifecycle and focus traps; inspect its mounted surfaces at key time.
export function shortcutSurfaceOpen() {
	return (
		document.querySelector(
			'[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"]), [role="menu"]:not([data-state="closed"])'
		) !== null
	);
}
