export const createTodoShortcut = { key: "Mod+N", label: "Add Todo item" } as const;
export const undoTodoShortcut = { key: "Mod+Z", label: "Undo last Todo-file change" } as const;
export const rowShortcuts = {
	up: { key: "ArrowUp", label: "Previous Todo item" },
	down: { key: "ArrowDown", label: "Next Todo item" },
	first: { key: "Home", label: "First Todo item" },
	last: { key: "End", label: "Last Todo item" },
	complete: { key: "Space", eventKey: " ", label: "Toggle completion" },
	details: { key: "Enter", label: "View Todo item details" },
	edit: { key: "e", label: "Edit Todo item" },
} as const;
