export type WorkspaceSessionOperation =
	| "restore"
	| "create_workspace"
	| "open_workspace"
	| "delete_workspace"
	| "set_todo_item_completion"
	| "delete_todo_item";

export type WorkspaceSessionActionResult =
	| { status: "applied" }
	| { status: "conflict"; message: string }
	| { status: "rejected"; message: string };
