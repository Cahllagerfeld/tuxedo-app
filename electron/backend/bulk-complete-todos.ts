import { setTodoCompletionLine } from "./complete-todo";
import { replaceTodoLines } from "./replace-todo-lines";
import { planRecurringCompletion } from "./recurrence";
import type { TodoFile } from "../../src/lib/shared/desktop/contract";
/** Plan every replacement before inserting successors at the original physical positions. */
export function bulkCompleteTodos(
	contents: string,
	todoFile: TodoFile,
	targets: readonly { lineNumber: number; expectedRaw: string }[],
	completed: boolean,
	today: Date
): { contents: string; notice?: string } {
	const byLine = new Map(todoFile.items.map((item) => [item.line_number, item]));
	for (const target of targets) {
		const item = byLine.get(target.lineNumber);
		if (!item || item.raw !== target.expectedRaw)
			throw Error("The Todo item changed on disk. Review its current contents.");
	}
	const eligibleItems = targets
		.map((target) => byLine.get(target.lineNumber)!)
		.filter((item) => item.completed !== completed);
	if (eligibleItems.length === 0) return { contents };
	if (!completed)
		return {
			contents: replaceTodoLines(
				contents,
				eligibleItems.map((item) => ({
					lineNumber: item.line_number,
					raw: setTodoCompletionLine(item, false, today),
				}))
			),
		};
	const plans = eligibleItems.map((item) =>
		planRecurringCompletion(contents, item, setTodoCompletionLine(item, true, today), today)
	);
	const generated = plans.filter((plan) => plan.recurrence === "generated").length;
	const unsupported = plans.filter((plan) => plan.recurrence === "unsupported").length;
	const notice = [
		`Generated ${generated} next ${generated === 1 ? "occurrence" : "occurrences"}.`,
		...(unsupported
			? [`Skipped ${unsupported} unsupported Repeat ${unsupported === 1 ? "rule" : "rules"}.`]
			: []),
	].join(" ");
	return {
		contents: replaceTodoLines(contents, plans),
		...(generated || unsupported ? { notice } : {}),
	};
}
