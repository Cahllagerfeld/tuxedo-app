import { z } from "zod";
export const todoItemSchema = z.strictObject({
	line_number: z.number().int().positive(),
	raw: z.string(),
	completed: z.boolean(),
	priority: z
		.string()
		.regex(/^[A-Z]$/)
		.nullable(),
	creation_date: z.string().nullable(),
	completion_date: z.string().nullable(),
	description: z.string().min(1),
	projects: z.array(z.string()),
	contexts: z.array(z.string()),
	metadata: z.record(z.string(), z.string()),
});
export const skippedLineSchema = z.strictObject({
	line_number: z.number().int().positive(),
	raw: z.string(),
	reason: z.string().min(1),
});
export const todoFileSchema = z.strictObject({
	path: z.string().min(1),
	items: z.array(todoItemSchema),
	skipped: z.array(skippedLineSchema),
});
export type TodoFile = z.infer<typeof todoFileSchema>;
export type TodoItem = z.infer<typeof todoItemSchema>;
export type SkippedLine = z.infer<typeof skippedLineSchema>;
