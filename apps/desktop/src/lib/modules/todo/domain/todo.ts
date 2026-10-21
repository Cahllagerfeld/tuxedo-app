import type {
	TodoItem as ContractTodoItem,
	TodoFile as ContractTodoFile,
	SkippedLine as ContractSkippedLine,
} from "@tuxedo/contracts/todo";
export { todoItemSchema, todoFileSchema, skippedLineSchema } from "@tuxedo/contracts/todo";
export type TodoItem = Readonly<Omit<ContractTodoItem, "projects" | "contexts" | "metadata">> & {
	readonly projects: readonly string[];
	readonly contexts: readonly string[];
	readonly metadata: Readonly<ContractTodoItem["metadata"]>;
};
export type SkippedLine = Readonly<ContractSkippedLine>;
export type TodoFile = Readonly<Omit<ContractTodoFile, "items" | "skipped">> & {
	readonly items: readonly TodoItem[];
	readonly skipped: readonly SkippedLine[];
};
