import * as Schema from "effect/Schema";
import { effectValidator } from "./effect-validation";

export function normalizeTodoDescription(value: string): string {
	return value
		.trim()
		.replace(/\p{White_Space}+/gu, " ")
		.trim();
}

function containsTodoToken(value: string): boolean {
	return normalizeTodoDescription(value)
		.split(" ")
		.some(
			(token) =>
				token.startsWith("board:") ||
				/^[+@]\S+$/u.test(token) ||
				/^[^:\p{White_Space}]+:[^:\p{White_Space}]+$/u.test(token)
		);
}

export const TodoTag = Schema.String.check(
	Schema.makeFilter((value) =>
		value.length > 0 && value === value.trim() && !/[\s\p{White_Space}]/u.test(value)
			? undefined
			: "Todo tags must be trimmed and must not contain whitespace"
	)
);
export const TodoTags = Schema.mutable(Schema.Array(TodoTag)).check(
	Schema.makeFilter((values) =>
		new Set(values).size === values.length ? undefined : "Todo tags must be unique"
	)
);
export const TodoDescription = Schema.String.check(
	Schema.makeFilter((value) =>
		containsTodoToken(value)
			? "Use the Project, Context, and Metadata inputs for these tokens."
			: undefined
	)
);
export const TodoDate = Schema.String.check(
	Schema.makeFilter((value) => {
		if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return "Use a valid date in YYYY-MM-DD format.";
		const date = new Date(value + "T00:00:00Z");
		return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
			? undefined
			: "Use a valid date in YYYY-MM-DD format.";
	})
);
export const TodoMetadata = Schema.String.check(
	Schema.makeFilter((value) =>
		!/^(?:[^:\s\p{White_Space}]+:[^:\s\p{White_Space}]+|board:[^\p{White_Space}]*)$/u.test(value)
			? "Use key:value without spaces or extra colons."
			: /^[+@]/u.test(value)
				? "Metadata keys must not start with + or @."
				: undefined
	)
);
export const TodoPriority = Schema.String.check(Schema.isPattern(/^[A-Z]$/u));
export const TodoRepeatRule = Schema.String.check(Schema.isPattern(/^[1-9][0-9]*[dwmy]$/u));
export const todoRepeatRuleSchema = effectValidator(TodoRepeatRule);
export const todoCreationFields = {
	description: TodoDescription,
	projects: TodoTags,
	contexts: TodoTags,
	priority: Schema.optional(Schema.NullOr(TodoPriority)),
	creationDate: Schema.optional(Schema.NullOr(TodoDate)),
	completed: Schema.optional(Schema.Boolean),
	completionDate: Schema.optional(Schema.NullOr(TodoDate)),
	metadata: Schema.optional(Schema.mutable(Schema.Array(TodoMetadata))),
};
type TodoCreation = Schema.Schema.Type<typeof TodoCreationFields>;
const TodoCreationFields = Schema.Struct(todoCreationFields);
export function todoCreationIssues(input: TodoCreation, editing = false) {
	const issues: Array<{ path: string[]; issue: string }> = [];
	const issue = (path: string, message: string) => issues.push({ path: [path], issue: message });
	if (
		input.completed &&
		!input.completionDate &&
		(!editing || (input.creationDate && !input.priority))
	)
		issue("completionDate", "Choose a Completion date for a completed Todo item.");
	if (!input.completed && input.completionDate)
		issue("completionDate", "Only completed Todo items have a Completion date.");
	if (
		!editing &&
		input.completed &&
		input.priority &&
		input.metadata?.some((value) => value.startsWith("pri:"))
	)
		issue(
			"metadata",
			"Remove pri Metadata or clear Priority; Priority is saved as pri Metadata on completion."
		);
	const description = normalizeTodoDescription(input.description);
	const followedByTokens = !!(
		input.projects.length ||
		input.contexts.length ||
		input.metadata?.length ||
		(input.completed && input.priority)
	);
	const leadingText = description + (followedByTokens ? " " : "");
	if (
		!description &&
		!input.projects.length &&
		!input.contexts.length &&
		!input.metadata?.length &&
		!input.priority &&
		input.creationDate === null &&
		!input.completed
	)
		issue("description", "Enter a Description or another Todo-item value.");
	// Prefix-looking text would be parsed as structured fields when dates are omitted.
	if (
		input.creationDate === null &&
		(/^\d{4}-\d{2}-\d{2}(?: |$)/u.test(description) ||
			((!input.priority || (input.completed && !editing)) && /^\([A-Z]\) /u.test(leadingText)) ||
			(!input.completed && !input.priority && /^x /u.test(leadingText)))
	)
		issue(
			"description",
			"Use the Priority, date, and Completed controls for leading Todo markers."
		);
	return issues;
}
export const TodoCreationRequest = Schema.Struct({
	...todoCreationFields,
	scope: Schema.String.check(Schema.isUUID()),
	revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	workspaceId: Schema.String.check(Schema.isUUID()),
}).check(Schema.makeFilter((input) => todoCreationIssues(input)));
export const createTodoRequestSchema = effectValidator(TodoCreationRequest);
export const todoTagSchema = effectValidator(TodoTag);
export const todoDateSchema = effectValidator(TodoDate);
export const todoMetadataSchema = effectValidator(TodoMetadata);

const TodoEditorFields = Schema.Struct({
	completed: Schema.optional(Schema.Boolean),
	description: TodoDescription,
	projects: TodoTags,
	contexts: TodoTags,
	priority: Schema.String.check(
		Schema.makeFilter((value) =>
			value === "none" || Schema.is(TodoPriority)(value)
				? undefined
				: "Choose None, A, B, C, or enter one letter from D to Z."
		)
	),
	creationDate: Schema.Union([Schema.Literal(""), TodoDate]),
	completionDate: Schema.Union([Schema.Literal(""), TodoDate]),
	metadata: Schema.mutable(Schema.Array(TodoMetadata)),
	repeatInterval: Schema.String,
	repeatUnit: Schema.String.check(Schema.isPattern(/^(off|unsupported|[dwmy])$/u)),
});
export type TodoEditorData = typeof TodoEditorFields.Type;
export function todoEditorDraft(data: TodoEditorData, completed: boolean) {
	const { repeatInterval: _, repeatUnit: __, ...fields } = data;
	return {
		...fields,
		description: normalizeTodoDescription(data.description),
		priority: data.priority === "none" ? null : data.priority,
		creationDate: data.creationDate || null,
		completed,
		completionDate: data.completionDate || null,
	};
}
export function todoEditorSchema(state: () => { editing: boolean; completed: boolean }) {
	return Schema.toStandardSchemaV1(
		TodoEditorFields.check(
			Schema.makeFilter((data) => {
				const issues = todoCreationIssues(
					todoEditorDraft(data, data.completed ?? state().completed),
					state().editing
				);
				if (
					data.repeatUnit !== "off" &&
					data.repeatUnit !== "unsupported" &&
					!todoRepeatRuleSchema.safeParse(data.repeatInterval + data.repeatUnit).success
				)
					issues.push({
						path: ["repeatInterval"],
						issue: "Enter a positive whole-number interval.",
					});
				return issues;
			})
		),
		{ parseOptions: { onExcessProperty: "error", errors: "all" } }
	);
}
