import type { DesktopRequest } from "$lib/shared/desktop/contract";

export type TodoItemDraft = Omit<
	DesktopRequest<"createTodo">,
	"scope" | "revision" | "workspaceId"
>;

export type SaveTodoItemResult =
	| { status: "applied" }
	| { status: "conflict"; message: string }
	| { status: "rejected"; message: string };

export type SaveTodoItem = (input: TodoItemDraft) => Promise<SaveTodoItemResult>;
