import { z } from "zod";
import { todoFileSchema } from "$lib/modules/todo/domain/todo";

export const workspaceSchema = z.object({
	id: z.uuid(),
	name: z.string().min(1),
	color: z.enum(["blue", "green", "amber", "red", "violet", "pink", "cyan", "orange"]),
	todo_path: z.string(),
	created_at: z.iso.datetime({ offset: true }),
});

export const workspaceCatalogueSchema = z.object({
	version: z.literal(1),
	active_workspace_id: z.string().uuid().nullable(),
	workspaces: z.array(workspaceSchema),
});

export const workspaceLoadResultSchema = z.object({
	workspace: workspaceSchema,
	todo_file: todoFileSchema,
});

export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceCatalogue = z.infer<typeof workspaceCatalogueSchema>;
export type WorkspaceLoadResult = z.infer<typeof workspaceLoadResultSchema>;

function formatSchemaIssues(error: z.ZodError): string {
	return error.issues
		.map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
		.join("; ");
}

function parseResponse<T>(schema: z.ZodType<T>, response: unknown, label: string): T {
	const result = schema.safeParse(response);
	if (result.success) return result.data;
	throw new Error(`Unexpected ${label} response from Rust: ${formatSchemaIssues(result.error)}`);
}

export function parseWorkspaceCatalogueResponse(response: unknown): WorkspaceCatalogue {
	return parseResponse(workspaceCatalogueSchema, response, "workspace catalogue");
}

export function parseWorkspaceLoadResponse(response: unknown): WorkspaceLoadResult {
	return parseResponse(workspaceLoadResultSchema, response, "workspace load");
}
