import { CalendarDate, parseDate } from "@internationalized/date";
import { todoDateSchema } from "../../src/lib/shared/desktop/contract";
import type { TodoItem } from "../../src/lib/shared/desktop/todo";
import { createTodoLine } from "./create-todo";
import { parseTodoFile } from "./todo-file";
import { replaceTodoLines } from "./replace-todo-lines";

export const generationMarker = "tuxedo-generated";

function nextDueDate(completion: string | null, rule: RegExpExecArray): string {
	if (!completion || !todoDateSchema.safeParse(completion).success)
		throw Error("Recurring completion requires a valid Completion date.");
	const anchor = parseDate(completion);
	const interval = Number(rule[1]);
	const unit = rule[2];
	const maximum = new CalendarDate(9999, 12, 31);
	const limit =
		unit === "y"
			? 9999 - anchor.year
			: unit === "m"
				? (9999 - anchor.year) * 12 + 12 - anchor.month
				: maximum.calendar.toJulianDay(maximum) - anchor.calendar.toJulianDay(anchor);
	const amount = unit === "w" ? interval * 7 : interval;
	if (anchor.toString() !== completion || !Number.isSafeInteger(amount) || amount > limit)
		throw Error("The recurrence interval exceeds the supported date range.");
	const due = anchor
		.add(unit === "y" ? { years: amount } : unit === "m" ? { months: amount } : { days: amount })
		.toString();
	return todoDateSchema.parse(due);
}

/** Complete and insert against the original physical positions before one atomic commit. */
export function recurringCompletion(
	contents: string,
	source: TodoItem,
	raw: string,
	today: Date,
	priority: string | null = source.priority
): { contents: string; notice?: string } {
	const completed = parseTodoFile("", raw).items[0];
	if (!completed || !completed.completed) throw Error("Invalid completed Todo item.");
	const replace = (line: string) =>
		replaceTodoLines(contents, [{ lineNumber: source.line_number, raw: line }]);
	if (
		source.completed ||
		Object.hasOwn(source.metadata, generationMarker) ||
		!completed.metadata.rec
	)
		return { contents: replace(raw) };
	const rule = /^([1-9][0-9]*)([dwmy])$/u.exec(completed.metadata.rec);
	if (!rule)
		return {
			contents: replace(raw),
			notice: "Unsupported Repeat rule; no next occurrence generated.",
		};
	const due = nextDueDate(completed.completion_date, rule);
	if (
		priority &&
		completed.edit.metadata.some((token) => token.startsWith("pri:") && token !== `pri:${priority}`)
	)
		throw Error("Conflicting priority metadata; edit the Todo file before completing this item.");
	const successor = createTodoLine(
		{
			description: completed.edit.description,
			projects: [...completed.projects],
			contexts: [...completed.contexts],
			priority,
			metadata: completed.edit.metadata
				.filter(
					(token) =>
						!token.startsWith("due:") &&
						!token.startsWith(`${generationMarker}:`) &&
						!(priority && token === `pri:${priority}`)
				)
				.concat(`due:${due}`),
		},
		today
	);
	const lines = contents.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	const line = lines[source.line_number - 1];
	const ending = line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "";
	const separator = ending || contents.match(/\r\n|\n/u)?.[0] || "\n";
	lines[source.line_number - 1] = `${raw} ${generationMarker}:1${separator}${successor}${ending}`;
	return { contents: lines.join(""), notice: `Next occurrence due ${due}.` };
}
