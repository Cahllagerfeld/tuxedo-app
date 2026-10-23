import type { DesktopRequest } from "@tuxedo/contracts";

export type TodoItemDraft = Omit<
	DesktopRequest<"createTodo">,
	"scope" | "revision" | "workspaceId"
>;

export type SaveTodoItemResult =
	| { status: "applied"; notice?: string }
	| { status: "conflict"; message: string }
	| { status: "rejected"; message: string };

export type SaveTodoItem = (input: TodoItemDraft) => Promise<SaveTodoItemResult>;
