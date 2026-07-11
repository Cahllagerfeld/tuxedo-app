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

export const workspaceSessionSnapshotSchema = z
	.object({
		catalogue: workspaceCatalogueSchema,
		todo_file: todoFileSchema.nullable(),
		warning: z.string().nullable(),
	})
	.superRefine(({ catalogue, todo_file, warning }, context) => {
		const activeWorkspace = catalogue.workspaces.find(
			({ id }) => id === catalogue.active_workspace_id
		);
		if (!activeWorkspace) {
			if (todo_file || warning) {
				context.addIssue({
					code: "custom",
					message: "An inactive catalogue cannot include a Todo file or warning",
				});
			}
			return;
		}
		if (!todo_file) {
			if (!warning) {
				context.addIssue({
					code: "custom",
					message: "An active workspace requires a Todo file or restoration warning",
				});
			}
			return;
		}
		if (warning) {
			context.addIssue({ code: "custom", message: "A loaded Todo file cannot include a warning" });
		}
		if (activeWorkspace.todo_path !== todo_file.path) {
			context.addIssue({
				code: "custom",
				message: "Todo file must belong to the active workspace",
			});
		}
	});

export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceCatalogue = z.infer<typeof workspaceCatalogueSchema>;
export type WorkspaceSessionSnapshot = z.infer<typeof workspaceSessionSnapshotSchema>;

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

export function parseWorkspaceSessionSnapshotResponse(response: unknown): WorkspaceSessionSnapshot {
	return parseResponse(workspaceSessionSnapshotSchema, response, "workspace session snapshot");
}
