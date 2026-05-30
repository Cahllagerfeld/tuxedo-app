import { z } from "zod";
import { todoFileSchema } from "$lib/modules/todo/domain/todo";

export const workspaceEntrySchema = z.object({
	id: z.string(),
	name: z.string(),
	color: z.string(),
	root: z.string(),
	last_opened_at: z.string(),
});

export const workspaceConfigSchema = z.object({
	active_workspace_id: z.string().nullable(),
	recent_workspaces: z.array(workspaceEntrySchema),
});

export const workspaceLoadResultSchema = z.object({
	root: z.string(),
	todo_path: z.string(),
	todo_exists: z.boolean(),
	todo_file: todoFileSchema.nullable(),
});

export type WorkspaceEntry = z.infer<typeof workspaceEntrySchema>;
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export type WorkspaceLoadResult = z.infer<typeof workspaceLoadResultSchema>;

function formatSchemaIssues(error: z.ZodError): string {
	return error.issues
		.map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
		.join("; ");
}

export function parseWorkspaceConfigResponse(response: unknown): WorkspaceConfig {
	const result = workspaceConfigSchema.safeParse(response);

	if (result.success) {
		return result.data;
	}

	throw new Error(
		`Unexpected workspace config response from Rust: ${formatSchemaIssues(result.error)}`
	);
}

export function parseWorkspaceLoadResponse(response: unknown): WorkspaceLoadResult {
	const result = workspaceLoadResultSchema.safeParse(response);

	if (result.success) {
		return result.data;
	}

	throw new Error(
		`Unexpected workspace load response from Rust: ${formatSchemaIssues(result.error)}`
	);
}
