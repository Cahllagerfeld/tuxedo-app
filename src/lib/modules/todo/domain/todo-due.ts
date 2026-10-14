import { todoDateSchema } from "$lib/shared/desktop/todo-creation";

export type TodoDueCategory = "overdue" | "today" | "upcoming" | "none";
export const dueLabels: Record<TodoDueCategory, string> = {
	overdue: "Overdue",
	today: "Today",
	upcoming: "Upcoming",
	none: "No due date",
};

export function validDueDate(value: string | undefined): string | null {
	return value && todoDateSchema.safeParse(value).success ? value : null;
}

export function localToday(date = new Date()): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dueCategory(value: string | undefined, today: string): TodoDueCategory {
	const due = validDueDate(value);
	return !due ? "none" : due < today ? "overdue" : due === today ? "today" : "upcoming";
}
