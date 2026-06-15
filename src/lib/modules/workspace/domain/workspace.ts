import { z } from "zod";

export const workspaceConfigSchema = z.object({
	version: z.number(),
	root: z.string().nullable(),
});

export const workspaceTodoResolutionSchema = z.object({
	root: z.string(),
	todo_path: z.string(),
	todo_exists: z.boolean(),
});

export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export type WorkspaceTodoResolution = z.infer<typeof workspaceTodoResolutionSchema>;

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

export function parseWorkspaceTodoResolutionResponse(response: unknown): WorkspaceTodoResolution {
	const result = workspaceTodoResolutionSchema.safeParse(response);

	if (result.success) {
		return result.data;
	}

	throw new Error(
		`Unexpected workspace todo resolution response from Rust: ${formatSchemaIssues(result.error)}`
	);
}
