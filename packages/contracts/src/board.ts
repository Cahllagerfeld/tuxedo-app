import * as Schema from "effect/Schema";
import { effectValidator } from "./effect-validation";

export const BoardColumn = Schema.Literals(["unassigned", "to-do", "in-progress"]);
export type BoardColumn = typeof BoardColumn.Type;
/** A board move destination; Done completes the Todo item instead of assigning a column. */
export const BoardDestination = Schema.Literals([...BoardColumn.literals, "done"]);
export type BoardDestination = typeof BoardDestination.Type;

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

/** Decode the effective board metadata value, retaining unsupported values as invalid. */
export function boardAssignment(value: string | undefined): {
	column: BoardColumn;
	invalid: boolean;
} {
	if (value === undefined) return { column: "unassigned", invalid: false };
	const [column, position, ...extra] = value.split("/");
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
