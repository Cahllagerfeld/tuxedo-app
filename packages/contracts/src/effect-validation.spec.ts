import { expect, test } from "vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import { effectValidator } from "@tuxedo/contracts/effect-validation";

const validator = effectValidator(
	Schema.Struct({
		revision: Schema.NumberFromString.check(Schema.isInt()),
		item: Schema.Struct({ description: Schema.NonEmptyString }),
	})
);

test("both validation methods return decoded plain data synchronously", () => {
	const input = { revision: "2", item: { description: "Buy milk" } };
	const decoded = { revision: 2, item: { description: "Buy milk" } };
	expect(validator.parse(input)).toEqual(decoded);
	expect(validator.safeParse(input)).toEqual({ success: true, data: decoded });
});

test("parse throws while safeParse returns all errors with nested field paths", () => {
	const input = { revision: "invalid", item: { description: "" } };
	expect(() => validator.parse(input)).toThrow();
	const result = validator.safeParse(input);
	expect(result.success).toBe(false);
	if (!result.success) {
		expect(result.error.issues).toHaveLength(2);
		expect(result.error.issues.map((issue) => issue.path)).toEqual([
			["revision"],
			["item", "description"],
		]);
		expect(result.error.issues.every((issue) => issue.message.length > 0)).toBe(true);
	}
});

test.each([
	{ revision: "2", item: { description: "Buy milk" }, path: "/tmp/other.todo" },
	{ revision: "2", item: { description: "Buy milk", completed: true } },
])("both validation methods reject unexpected fields instead of dropping them %#", (input) => {
	expect(() => validator.parse(input)).toThrow();
	expect(validator.safeParse(input).success).toBe(false);
});

test("safeParse rejects asynchronous schemas at the synchronous desktop boundary", () => {
	const asynchronous = effectValidator(
		Schema.String.pipe(
			Schema.decode({
				decode: SchemaGetter.transformEffect((value) =>
					Effect.gen(function* () {
						yield* Effect.sleep("1 millis");
						return value;
					})
				),
				encode: SchemaGetter.passthrough(),
			})
		)
	);
	expect(() => asynchronous.safeParse("Buy milk")).toThrow(
		"Desktop schemas must validate synchronously"
	);
});
