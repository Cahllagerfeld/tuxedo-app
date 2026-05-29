import { z } from "zod";

export const todoItemSchema = z.object({
	line_number: z.number(),
	raw: z.string(),
	completed: z.boolean(),
	priority: z.string().length(1).nullable(),
	creation_date: z.string().nullable(),
	completion_date: z.string().nullable(),
	description: z.string(),
	projects: z.array(z.string()),
	contexts: z.array(z.string()),
	metadata: z.record(z.string(), z.string()),
});

export const skippedLineSchema = z.object({
	line_number: z.number(),
	raw: z.string(),
	reason: z.string(),
});

export const todoFileSchema = z.object({
	path: z.string(),
	items: z.array(todoItemSchema),
	skipped: z.array(skippedLineSchema),
});

export type TodoItem = z.infer<typeof todoItemSchema>;
export type SkippedLine = z.infer<typeof skippedLineSchema>;
export type TodoFile = z.infer<typeof todoFileSchema>;

export function parseTodoFileResponse(response: unknown): TodoFile {
	const result = todoFileSchema.safeParse(response);

	if (result.success) {
		return result.data;
	}

	const message = result.error.issues
		.map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
		.join("; ");

	throw new Error(`Unexpected todo file response from Rust: ${message}`);
}
