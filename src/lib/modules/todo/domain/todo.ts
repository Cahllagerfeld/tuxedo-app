import { z } from "zod";

export type TodoItem = {
	line_number: number;
	raw: string;
	completed: boolean;
	priority: string | null;
	creation_date: string | null;
	completion_date: string | null;
	description: string;
	projects: string[];
	contexts: string[];
	metadata: Record<string, string>;
};

export type SkippedLine = {
	line_number: number;
	raw: string;
	reason: string;
};

export type TodoFile = {
	path: string;
	items: TodoItem[];
	skipped: SkippedLine[];
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
