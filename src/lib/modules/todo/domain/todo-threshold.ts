import { todoDateSchema } from "$lib/shared/desktop/todo-creation";
import type { TodoItem } from "./todo";

export function showFromDate(item: TodoItem): string | null {
	const value = item.metadata.t;
	return value && todoDateSchema.safeParse(value).success ? value : null;
}

export function isDeferred(item: TodoItem, today: string): boolean {
	const date = showFromDate(item);
	return !item.completed && date !== null && date > today;
}
