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

function validDate(value: string | undefined): string | null {
	return value !== undefined && todoDateSchema.safeParse(value).success ? value : null;
}

/** Keep the source Show-from-minus-Due offset. Positive addition past 9999 clamps, so reject first. */
function nextShowFrom(show: string, sourceDue: string, due: string): string {
	const from = parseDate(show);
	const origin = parseDate(sourceDue);
	const target = parseDate(due);
	const offset = from.calendar.toJulianDay(from) - origin.calendar.toJulianDay(origin);
	const minimum = new CalendarDate(1, 1, 1);
	const maximum = new CalendarDate(9999, 12, 31);
	const julian = target.calendar.toJulianDay(target) + offset;
	if (
		from.toString() !== show ||
		origin.toString() !== sourceDue ||
		target.toString() !== due ||
		!Number.isSafeInteger(offset) ||
		julian < minimum.calendar.toJulianDay(minimum) ||
		julian > maximum.calendar.toJulianDay(maximum)
	)
		throw Error("The next Show from date is outside the supported date range.");
	const shifted = target.add({ days: offset }).toString();
	if (!todoDateSchema.safeParse(shifted).success)
		throw Error("The next Show from date is outside the supported date range.");
	return shifted;
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
	const show = validDate(completed.metadata.t);
	const sourceDue = validDate(completed.metadata.due);
	const showFrom = show && sourceDue ? nextShowFrom(show, sourceDue, due) : null;
	const todayText = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
	const absoluteThreshold = (token: string) =>
		token.startsWith("t:") && validDate(token.slice(2)) !== null;
	const metadata = completed.edit.metadata.filter(
		(token) =>
			!token.startsWith("due:") &&
			!token.startsWith(`${generationMarker}:`) &&
			!(priority && token === `pri:${priority}`) &&
			!(show && !showFrom && absoluteThreshold(token))
	);
	if (showFrom) {
		const last = metadata.findLastIndex(absoluteThreshold);
		if (last >= 0) metadata[last] = `t:${showFrom}`;
	}
	metadata.push(`due:${due}`);
	const successor = createTodoLine(
		{
			description: completed.edit.description,
			projects: [...completed.projects],
			contexts: [...completed.contexts],
			priority,
			metadata,
		},
		today
	);
	const lines = contents.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	const line = lines[source.line_number - 1];
	const ending = line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "";
	const separator = ending || contents.match(/\r\n|\n/u)?.[0] || "\n";
	lines[source.line_number - 1] = `${raw} ${generationMarker}:1${separator}${successor}${ending}`;
	return {
		contents: lines.join(""),
		notice:
			showFrom && showFrom > todayText
				? `Next occurrence due ${due}. Show from ${showFrom}.`
				: `Next occurrence due ${due}.`,
	};
}
