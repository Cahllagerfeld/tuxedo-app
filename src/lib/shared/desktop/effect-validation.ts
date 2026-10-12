import * as Schema from "effect/Schema";

// Preserve synchronous plain-data validation while Zod operations are migrated.
export function effectValidator<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
	const standard = Schema.toStandardSchemaV1(schema, {
		parseOptions: { onExcessProperty: "error", errors: "all" },
	});
	return {
		parse: Schema.decodeUnknownSync(schema, { onExcessProperty: "error", errors: "all" }),
		safeParse(value: unknown) {
			const result = standard["~standard"].validate(value);
			if (result instanceof Promise) throw Error("Desktop schemas must validate synchronously");
			return result.issues
				? { success: false as const, error: { issues: result.issues } }
				: { success: true as const, data: result.value };
		},
	};
}
