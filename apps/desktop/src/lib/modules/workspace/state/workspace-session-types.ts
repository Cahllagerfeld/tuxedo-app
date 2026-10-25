export type WorkspaceSessionOperation =
	| "set_workspace_sort_order"
	| "set_workspace_show_deferred"
	| "undo_todo_change"
	| "restore"
	| "save_view"
	| "delete_view"
	| "refresh_saved_views"
	| "create_workspace"
	| "open_workspace"
	| "delete_workspace"
	| "set_todo_item_completion"
	| "bulk_set_todo_item_completion"
	| "bulk_delete_todo_items"
	| "delete_todo_item"
	| "create_todo_item"
	| "edit_todo_item"
	| "reorder_todo_items";

export type WorkspaceSessionActionResult =
	| {
			status: "applied";
			notice?: string;
			workspaceId?: string | null;
			activeWorkspaceId?: string | null;
	  }
	| { status: "conflict"; message: string }
	| { status: "rejected"; message: string };

export type WorkspaceSessionOperationTarget =
	{ workspaceId: string; lineNumber?: number } | { todoPath: string };

export type PendingWorkspaceSessionOperation = {
	operation: WorkspaceSessionOperation;
	target: WorkspaceSessionOperationTarget | null;
};
