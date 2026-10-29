import * as Schema from "effect/Schema";
import { effectValidator } from "./effect-validation";

export const BoardColumn = Schema.Literals(["unassigned", "to-do", "in-progress"]);
export type BoardColumn = typeof BoardColumn.Type;

const BoardAssignment = Schema.Struct({
	column: BoardColumn,
	position: Schema.optional(
		Schema.Int.check(
			Schema.isGreaterThanOrEqualTo(0),
			Schema.makeFilter((value) => Number.isSafeInteger(value) || "Invalid board position")
		)
	),
});
const boardAssignmentSchema = effectValidator(BoardAssignment);

/** Read the last board token, including malformed values. */
export function boardAssignment(raw: string): { column: BoardColumn; invalid: boolean } {
	const token = raw.split(/\p{White_Space}+/u).findLast((part) => part.startsWith("board:"));
	if (token === undefined) return { column: "unassigned", invalid: false };
	const [column, position, ...extra] = token.slice(6).split("/");
	if (extra.length || (position !== undefined && !/^(?:0|[1-9]\d*)$/u.test(position)))
		return { column: "unassigned", invalid: true };
	const parsed = boardAssignmentSchema.safeParse({
		column,
		...(position === undefined ? {} : { position: Number(position) }),
	});
	return parsed.success
		? { column: parsed.data.column, invalid: false }
		: { column: "unassigned", invalid: true };
}
