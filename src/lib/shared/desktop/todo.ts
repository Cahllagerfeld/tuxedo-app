import * as Schema from "effect/Schema";
import { effectValidator } from "./effect-validation";
import { TodoPriority } from "./todo-creation";

const LineNumber = Schema.Int.check(Schema.isGreaterThan(0));
export const TodoItemSchema = Schema.Struct({
	line_number: LineNumber,
	raw: Schema.String,
	completed: Schema.Boolean,
	priority: Schema.NullOr(TodoPriority),
	creation_date: Schema.NullOr(Schema.String),
	completion_date: Schema.NullOr(Schema.String),
	description: Schema.NonEmptyString,
	edit: Schema.Struct({
		description: Schema.String,
		metadata: Schema.mutable(Schema.Array(Schema.String)),
	}),
	projects: Schema.mutable(Schema.Array(Schema.String)),
	contexts: Schema.mutable(Schema.Array(Schema.String)),
	metadata: Schema.Record(Schema.String, Schema.String),
});
const SkippedLineSchema = Schema.Struct({
	line_number: LineNumber,
	raw: Schema.String,
	reason: Schema.NonEmptyString,
});
export const TodoFileSchema = Schema.Struct({
	path: Schema.NonEmptyString,
	items: Schema.mutable(Schema.Array(TodoItemSchema)),
	skipped: Schema.mutable(Schema.Array(SkippedLineSchema)),
});
export const todoFileSchema = effectValidator(TodoFileSchema);
export type TodoFile = typeof TodoFileSchema.Type;
export type TodoItem = typeof TodoItemSchema.Type;
export type SkippedLine = typeof SkippedLineSchema.Type;
