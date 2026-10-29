import {
	boardDoneKey,
	boardPlacement,
	sortBoardColumn,
	type BoardDestination,
} from "@tuxedo/contracts/board";
import type { TodoFile } from "@tuxedo/contracts";
import { replaceTodoLines } from "./replace-todo-lines";

/** Replace a metadata key's repeated tokens with one value, appending it when absent. */
export function setMetadataToken(raw: string, key: string, value: string): string {
	let replaced = false;
	const next = raw.replace(
		new RegExp(`(^|\\p{White_Space})${key}:[^\\p{White_Space}]*`, "gu"),
		(_token, whitespace: string) => {
			if (replaced) return whitespace;
			replaced = true;
			return `${whitespace}${key}:${value}`;
		}
	);
	return replaced
		? next
		: next.replace(
				/(\p{White_Space}*)$/u,
				(_suffix, whitespace: string) => ` ${key}:${value}${whitespace}`
			);
}

/** Remove a metadata key's tokens together with their separating whitespace. */
export function removeMetadataToken(raw: string, key: string): string {
	return raw.replace(
		new RegExp(
			`^${key}:[^\\p{White_Space}]*\\p{White_Space}*|\\p{White_Space}+${key}:[^\\p{White_Space}]*`,
			"gu"
		),
		""
	);
}

/**
 * Move one column's displayed items among their existing board slots, leaving hidden items in
 * place, without changing physical line order. Positions are renumbered from the column's
 * effective order; items after the last changed slot that have no explicit position keep none,
 * so untouched items are not rewritten.
 */
export function reorderBoardColumn(
	contents: string,
	todoFile: TodoFile,
	column: BoardDestination,
	lineNumbers: readonly number[]
): string {
	const current = sortBoardColumn(
		todoFile.items.filter((item) => boardPlacement(item).column === column)
	);
	const byLine = new Map(current.map((item) => [item.line_number, item]));
	const displayed = lineNumbers.map((line) => byLine.get(line));
	if (displayed.some((item) => !item)) throw Error("Invalid board position.");
	const shown = new Set(lineNumbers);
	const queue = [...displayed];
	const next = current.map((item) => (shown.has(item.line_number) ? queue.shift()! : item));
	const last = next.findLastIndex((item, index) => item !== current[index]);
	if (last < 0) return contents;
	return replaceTodoLines(
		contents,
		next.flatMap((item, index) => {
			const { position } = boardPlacement(item);
			if (position === index || (index > last && position === undefined)) return [];
			const raw =
				column === "done"
					? setMetadataToken(item.raw, boardDoneKey, String(index))
					: setMetadataToken(item.raw, "board", `${column}/${index}`);
			return [{ lineNumber: item.line_number, raw }];
		})
	);
}
