import { setTodoCompletionLine } from "./complete-todo";
import { recurringCompletion } from "./recurrence";
import type { TodoFile } from "../../src/lib/shared/desktop/contract";
/** Apply completions bottom-up so original line numbers stay valid until each item is handled. */
export function bulkCompleteTodos(
	contents: string,
	todoFile: TodoFile,
	targets: readonly { lineNumber: number; expectedRaw: string }[],
	today: Date
): { contents: string; notice?: string } {
	const byLine = new Map(todoFile.items.map((item) => [item.line_number, item]));
	for (const target of targets) {
		const item = byLine.get(target.lineNumber);
		if (!item || item.raw !== target.expectedRaw)
			throw Error("The Todo item changed on disk. Review its current contents.");
	}
	const openItems = targets
		.map((target) => byLine.get(target.lineNumber)!)
		.filter((item) => !item.completed)
		.sort((a, b) => b.line_number - a.line_number);
	if (openItems.length === 0) return { contents };
	let working = contents;
	let notice: string | undefined;
	for (const item of openItems) {
		const raw = setTodoCompletionLine(item, true, today);
		const result = recurringCompletion(working, item, raw, today);
		working = result.contents;
		if (result.notice) notice = result.notice;
	}
	return { contents: working, ...(notice ? { notice } : {}) };
}
