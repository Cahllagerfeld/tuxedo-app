import { workspaceShortcuts } from "#lib/modules/workspace/ui/shortcuts.js";
import { createTodoShortcut } from "#lib/modules/todo/ui/shortcuts.js";
import { SIDEBAR_SHORTCUT } from "#lib/shared/ui/sidebar/constants.js";

export const bindings = {
	...workspaceShortcuts,
	createTodo: createTodoShortcut,
	help: { key: "Mod+/", label: "Keyboard shortcuts" },
	sidebar: SIDEBAR_SHORTCUT,
} as const;
