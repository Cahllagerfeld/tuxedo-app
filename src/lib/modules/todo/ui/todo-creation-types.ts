export type CreateTodoItemInput = {
	description: string;
	projects: string[];
	contexts: string[];
};

export type CreateTodoItemResult =
	| { status: "applied" }
	| { status: "conflict"; message: string }
	| { status: "rejected"; message: string };

export type CreateTodoItem = (input: CreateTodoItemInput) => Promise<CreateTodoItemResult>;
