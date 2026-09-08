import { z } from "zod";

export type TodoItem = {
	readonly line_number: number;
	readonly raw: string;
	readonly completed: boolean;
	readonly priority: string | null;
	readonly creation_date: string | null;
	readonly completion_date: string | null;
	readonly description: string;
	readonly projects: readonly string[];
	readonly contexts: readonly string[];
	readonly metadata: Readonly<Record<string, string>>;
};

export type SkippedLine = {
	readonly line_number: number;
	readonly raw: string;
	readonly reason: string;
};

export type TodoFile = {
	readonly path: string;
	readonly items: readonly TodoItem[];
	readonly skipped: readonly SkippedLine[];
};

export const todoItemSchema: z.ZodType<TodoItem> = z.object({
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

export const skippedLineSchema: z.ZodType<SkippedLine> = z.object({
	line_number: z.number(),
	raw: z.string(),
	reason: z.string(),
});

export const todoFileSchema: z.ZodType<TodoFile> = z.object({
	path: z.string(),
	items: z.array(todoItemSchema),
	skipped: z.array(skippedLineSchema),
});
