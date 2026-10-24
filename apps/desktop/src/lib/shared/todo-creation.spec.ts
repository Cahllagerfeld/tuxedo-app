import { expect, test } from "vitest";
import { standard, standardClient } from "sveltekit-superforms/adapters";
import * as Schema from "effect/Schema";
import {
	createTodoRequestSchema,
	TodoCreationRequest,
	todoEditorDraft,
	todoEditorSchema,
	todoRepeatRuleSchema,
} from "@tuxedo/contracts/todo-creation";

const data = {
	description: "Buy milk",
	projects: [],
	contexts: [],
	priority: "none",
	creationDate: "",
	completionDate: "",
	metadata: [],
	repeatInterval: "1",
	repeatUnit: "off",
};
test("Standard Schema adapters preserve explicit editor defaults and field errors", async () => {
	const schema = todoEditorSchema(() => ({ editing: false, completed: false }));
	const adapter = standard(schema, { defaults: data });
	expect(adapter.defaults).toEqual(data);
	expect(await adapter.validate(data)).toEqual({ success: true, data });
	const invalid = await standardClient(schema).validate({ ...data, description: "x Buy milk" });
	expect(invalid.success).toBe(false);
	if (!invalid.success)
		expect(invalid.issues).toContainEqual({
			path: ["description"],
			message: "Use the Priority, date, and Completed controls for leading Todo markers.",
		});
});

const request = {
	scope: "9426bd98-a6dd-48eb-b1ab-037d82983ae1",
	revision: 0,
	workspaceId: "550e8400-e29b-41d4-a716-446655440000",
	description: "Buy milk",
	projects: [],
	contexts: [],
};
test.each([
	{},
	{ creationDate: undefined },
	{ creationDate: null },
	{ creationDate: "2024-02-29" },
])("creation preserves optional and nullable dates %#", (fields) => {
	const input = { ...request, ...fields };
	expect(createTodoRequestSchema.parse(input)).toEqual(input);
});
test.each([
	{ extra: true },
	{ revision: -1 },
	{ revision: 1.5 },
	{ workspaceId: "unknown" },
	{ creationDate: "2025-02-29" },
	{ creationDate: "2026-04-31" },
	{ creationDate: "" },
	{ completed: true },
	{ completed: false, completionDate: "2026-10-12" },
	{ completed: true, completionDate: "2026-10-12", priority: "A", metadata: ["pri:B"] },
	{ description: "(A) Buy milk", creationDate: null },
])("creation rejects expanded or invalid payloads %#", (fields) => {
	expect(() => createTodoRequestSchema.parse({ ...request, ...fields })).toThrow();
});
test.each([
	[{ completed: true }, "completionDate"],
	[{ completed: false, completionDate: "2026-10-12" }, "completionDate"],
	[
		{ completed: true, completionDate: "2026-10-12", priority: "A", metadata: ["pri:B"] },
		"metadata",
	],
])("creation Standard Schema retains cross-field paths %#", async (fields, path) => {
	const result = await Schema.toStandardSchemaV1(TodoCreationRequest)["~standard"].validate({
		...request,
		...fields,
	});
	expect(result.issues?.some((issue) => issue.path?.[0] === path)).toBe(true);
});
test("editor normalizes description and represents empty dates and Priority as null", () => {
	const { repeatInterval: _, repeatUnit: __, ...fields } = data;
	expect(todoEditorDraft({ ...data, description: "  Buy\u0085 milk  " }, false)).toEqual({
		...fields,
		description: "Buy milk",
		priority: null,
		creationDate: null,
		completionDate: null,
		completed: false,
	});
});
test("editing retains legacy completed items and rechecks the current completion state", async () => {
	let completed = true;
	const adapter = standardClient(todoEditorSchema(() => ({ editing: true, completed })));
	expect((await adapter.validate(data)).success).toBe(true);
	expect((await adapter.validate({ ...data, creationDate: "2026-10-12" })).success).toBe(false);
	completed = false;
	expect((await adapter.validate({ ...data, completionDate: "2026-10-12" })).success).toBe(false);
});

test("Repeat uses the same lowercase rule validation in editor forms and domain consumers", async () => {
	const adapter = standardClient(todoEditorSchema(() => ({ editing: true, completed: false })));
	for (const value of ["1d", "2w", "3m", "1y", "999999999999999999999d"])
		expect(todoRepeatRuleSchema.safeParse(value).success).toBe(true);
	for (const value of ["", "0d", "01w", "+1w", "1W", "1.5m", "-1y", "1e2d"])
		expect(todoRepeatRuleSchema.safeParse(value).success).toBe(false);
	const invalid = await adapter.validate({ ...data, repeatInterval: "0", repeatUnit: "w" });
	expect(invalid.success).toBe(false);
	if (!invalid.success)
		expect(invalid.issues).toContainEqual({
			path: ["repeatInterval"],
			message: "Enter a positive whole-number interval.",
		});
	expect((await adapter.validate({ ...data, repeatUnit: "fortnights" })).success).toBe(false);
	expect(
		(await adapter.validate({ ...data, repeatUnit: "unsupported", metadata: ["rec:+1w"] })).success
	).toBe(true);
});
