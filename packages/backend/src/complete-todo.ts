import type { TodoItem } from "@tuxedo/contracts/todo";
import { boardDoneKey } from "@tuxedo/contracts/board";
import { removeMetadataToken } from "./board-order";

export function setTodoCompletionLine(item: TodoItem, completed: boolean, date: Date): string {
	if (item.completed === completed)
		throw Error("Todo item already has the requested completion state.");
	const priorities = [
		...item.raw.matchAll(/(?:^|\p{White_Space})pri:([^:\p{White_Space}]+)(?=\p{White_Space}|$)/gu),
	].map((match) => match[1]);
	let raw: string;
	if (completed) {
		const today = `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
		let rest = item.raw;
		if (item.priority) {
			if (priorities.some((priority) => priority !== item.priority))
				throw Error(
					"Conflicting priority metadata; edit the Todo file before completing this item."
				);
			rest = rest.slice(4);
			if (!priorities.length) {
				const trailing = /\p{White_Space}*$/u.exec(rest)![0];
				rest = `${rest.slice(0, rest.length - trailing.length)} pri:${item.priority}${trailing}`;
			}
		}
		raw = `x ${today} ${rest}`;
	} else {
		let rest = item.raw.slice(2);
		if (item.completion_date) rest = rest.slice(11);
		// A Done position is meaningless once open; the Board assignment keeps the open position.
		rest = removeMetadataToken(rest, boardDoneKey);
		if (!item.priority && /^[A-Z]$/.test(item.metadata.pri ?? "")) {
			if (priorities.some((priority) => priority !== item.metadata.pri))
				throw Error(
					"Conflicting priority metadata; edit the Todo file before uncompleting this item."
				);
			rest = rest.replace(/(^|\p{White_Space})pri:[A-Z](?=\p{White_Space}|$)/gu, "");
			rest = `(${item.metadata.pri}) ${rest.replace(/^\p{White_Space}+/u, "")}`;
		}
		if (/^\p{White_Space}*$/u.test(rest))
			throw Error(
				"Cannot uncomplete a Todo item without remaining content. Edit the Todo file first."
			);
		raw = rest;
	}
	return raw;
}
