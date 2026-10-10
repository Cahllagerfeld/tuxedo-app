export type WorkspaceSessionOperation =
	| "restore"
	| "create_workspace"
	| "open_workspace"
	| "delete_workspace"
	| "set_todo_item_completion"
	| "delete_todo_item"
	| "create_todo_item"
	| "reorder_todo_items";

export type WorkspaceSessionActionResult =
	| { status: "applied" }
	| { status: "conflict"; message: string }
	| { status: "rejected"; message: string };

export type WorkspaceSessionOperationTarget =
	{ workspaceId: string; lineNumber?: number } | { todoPath: string };

export type PendingWorkspaceSessionOperation = {
	operation: WorkspaceSessionOperation;
	target: WorkspaceSessionOperationTarget | null;
};
