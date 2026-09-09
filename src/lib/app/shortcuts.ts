export const shortcuts = {
	workspaceSwitcher: {
		id: "workspace-switcher",
		label: "Open workspace switcher",
		hotkey: "Mod+P",
	},
	createWorkspace: { id: "create-workspace", label: "Create workspace", hotkey: "Mod+Shift+N" },
	shortcutHelp: { id: "shortcut-help", label: "Keyboard shortcuts", hotkey: "Mod+/" },
} as const;

export const shortcutList = Object.values(shortcuts);
