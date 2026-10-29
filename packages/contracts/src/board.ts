import * as Schema from "effect/Schema";
import { effectValidator } from "./effect-validation";

export const BoardColumn = Schema.Literals(["unassigned", "to-do", "in-progress"]);
export type BoardColumn = typeof BoardColumn.Type;
/** A board move destination; Done completes the Todo item instead of assigning a column. */
export const BoardDestination = Schema.Literals([...BoardColumn.literals, "done"]);
export type BoardDestination = typeof BoardDestination.Type;
/** Metadata key of a completed Todo item's Done position, kept apart from its Board assignment. */
export const boardDoneKey = "board-done";

const BoardPosition = Schema.Int.check(
	Schema.isGreaterThanOrEqualTo(0),
	Schema.makeFilter((value) => Number.isSafeInteger(value) || "Invalid board position")
);
const BoardAssignment = Schema.Struct({
	column: BoardColumn,
	position: Schema.optional(BoardPosition),
});
const boardAssignmentSchema = effectValidator(BoardAssignment);
const boardPositionSchema = effectValidator(BoardPosition);
const decimal = /^(?:0|[1-9]\d*)$/u;

/** Decode the effective board metadata value, retaining unsupported values as invalid. */
export function boardAssignment(value: string | undefined): {
	column: BoardColumn;
	position?: number;
	invalid: boolean;
} {
	if (value === undefined) return { column: "unassigned", invalid: false };
	const [column, position, ...extra] = value.split("/");
	if (extra.length || (position !== undefined && !decimal.test(position)))
		return { column: "unassigned", invalid: true };
	const parsed = boardAssignmentSchema.safeParse({
		column,
		...(position === undefined ? {} : { position: Number(position) }),
	});
	return parsed.success
		? { ...parsed.data, invalid: false }
		: { column: "unassigned", invalid: true };
}

/** Decode a Done position; unsupported values order like an absent position. */
export function boardDonePosition(value: string | undefined): number | undefined {
	if (value === undefined || !decimal.test(value)) return undefined;
	const parsed = boardPositionSchema.safeParse(Number(value));
	return parsed.success ? parsed.data : undefined;
}

type BoardItem = {
	line_number: number;
	completed: boolean;
	metadata: Readonly<Record<string, string>>;
};

export function boardPlacement(item: BoardItem): {
	column: BoardDestination;
	position: number | undefined;
} {
	if (item.completed)
		return { column: "done", position: boardDonePosition(item.metadata[boardDoneKey]) };
	const { column, position } = boardAssignment(item.metadata.board);
	return { column, position };
}

/**
 * Order one column's items: explicit positions first, then items without one, each in Todo-file
 * order. Equal or stale positions therefore resolve by Todo-file order.
 */
export function sortBoardColumn<T extends BoardItem>(items: readonly T[]): T[] {
	const keyed = items.map((item) => ({ item, position: boardPlacement(item).position }));
	return keyed
		.sort(
			(a, b) =>
				(a.position ?? Infinity) - (b.position ?? Infinity) ||
				a.item.line_number - b.item.line_number
		)
		.map(({ item }) => item);
}
