import { z } from "zod";

export function normalizeDescription(value: string): string {
	return value.split(/\s+/).filter(Boolean).join(" ");
}

export function isStructuredDescriptionToken(token: string): boolean {
	if (token.startsWith("+") && token.length > 1) return true;
	if (token.startsWith("@") && token.length > 1) return true;
	const separator = token.indexOf(":");
	if (separator <= 0 || separator === token.length - 1) return false;
	return !token.slice(separator + 1).includes(":");
}

export function normalizeTag(value: string, prefix: "+" | "@"): string | null {
	const trimmed = value.trim();
	const withoutPrefix = trimmed.startsWith(prefix) ? trimmed.slice(1) : trimmed;
	const normalized = withoutPrefix.trim();
	if (!normalized || /\s/.test(normalized)) return null;
	return normalized;
}

const tagSchema = (prefix: "+" | "@", kind: string) =>
	z
		.string()
		.trim()
		.transform((value) => (value.startsWith(prefix) ? value.slice(1).trim() : value))
		.refine((value) => value.length > 0, `${kind} must be non-empty`)
		.refine((value) => !/\s/.test(value), `${kind} must not contain whitespace`);

export const todoComposerSchema = z.object({
	description: z
		.string()
		.superRefine((value, ctx) => {
			const normalized = normalizeDescription(value);
			if (!normalized) {
				ctx.addIssue({ code: "custom", message: "Enter a Description." });
				return;
			}
			if (normalized.split(/\s+/).some(isStructuredDescriptionToken)) {
				ctx.addIssue({
					code: "custom",
					message: "Description cannot contain a standalone Project, Context, or Metadata token.",
				});
			}
		})
		.transform(normalizeDescription),
	projects: z.array(tagSchema("+", "Project")).superRefine((values, ctx) => {
		const seen = new Set<string>();
		for (const [index, value] of values.entries()) {
			if (seen.has(value)) {
				ctx.addIssue({
					code: "custom",
					message: `duplicate Project: ${value}`,
					path: [index],
				});
			}
			seen.add(value);
		}
	}),
	contexts: z.array(tagSchema("@", "Context")).superRefine((values, ctx) => {
		const seen = new Set<string>();
		for (const [index, value] of values.entries()) {
			if (seen.has(value)) {
				ctx.addIssue({
					code: "custom",
					message: `duplicate Context: ${value}`,
					path: [index],
				});
			}
			seen.add(value);
		}
	}),
});

export type TodoComposerValues = z.infer<typeof todoComposerSchema>;

export const todoComposerDefaults = {
	description: "",
	projects: [] as string[],
	contexts: [] as string[],
};
