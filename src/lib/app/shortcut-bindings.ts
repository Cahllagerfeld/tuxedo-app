import { workspaceShortcuts } from "$lib/modules/workspace/ui/shortcuts";
import { createTodoShortcut } from "$lib/modules/todo/ui/shortcuts";
import { SIDEBAR_SHORTCUT } from "$lib/shared/ui/sidebar/constants";

export const bindings = {
	...workspaceShortcuts,
	createTodo: createTodoShortcut,
	help: { key: "Mod+/", label: "Keyboard shortcuts" },
	sidebar: SIDEBAR_SHORTCUT,
} as const;
