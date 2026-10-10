import { createHotkey } from "@tanstack/svelte-hotkeys";
import { shortcutSurfaceOpen, shortcutPlatform } from "$lib/shared/keyboard";
import { shortcuts } from "./shortcuts";

type AppShortcutInputs = Readonly<{
	disabled: boolean;
	platform: typeof shortcutPlatform;
	helpTrigger: HTMLButtonElement | null;
	openSwitcher: () => void;
	openCreation: () => void;
}>;

// TanStack owns registration, reactive availability, and component lifecycle cleanup.
export function createAppShortcuts(inputs: AppShortcutInputs) {
	const actions = {
		workspaceSwitcher: () => inputs.openSwitcher(),
		workspaceCreation: () => inputs.openCreation(),
		help: () => {
			inputs.helpTrigger?.focus();
			inputs.helpTrigger?.click();
		},
	};
	for (const id of ["workspaceSwitcher", "workspaceCreation", "help"] as const) {
		createHotkey(
			shortcuts[id].binding,
			(event) => {
				if (event.repeat || shortcutSurfaceOpen() || (id !== "help" && inputs.disabled)) return;
				event.preventDefault();
				actions[id]();
			},
			() => ({
				enabled: id === "help" || !inputs.disabled,
				platform: inputs.platform,
				ignoreInputs: false,
				preventDefault: false,
				stopPropagation: false,
			})
		);
	}
}
