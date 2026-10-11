import type { DesktopRequest } from "$lib/shared/desktop/contract";

export type CreateTodoItemInput = Omit<
	DesktopRequest<"createTodo">,
	"scope" | "revision" | "workspaceId"
>;

export type CreateTodoItemResult =
	| { status: "applied" }
	| { status: "conflict"; message: string }
	| { status: "rejected"; message: string };

export type CreateTodoItem = (input: CreateTodoItemInput) => Promise<CreateTodoItemResult>;
