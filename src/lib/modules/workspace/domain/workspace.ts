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
	.discriminatedUnion("status", [
		z
			.object({
				status: z.literal("no_active_workspace"),
				catalogue: workspaceCatalogueSchema,
			})
			.strict(),
		z
			.object({
				status: z.literal("active_workspace_loaded"),
				catalogue: workspaceCatalogueSchema,
				todo_file: todoFileSchema,
			})
			.strict(),
		z
			.object({
				status: z.literal("active_workspace_unavailable"),
				catalogue: workspaceCatalogueSchema,
				warning: z.string().min(1),
			})
			.strict(),
	])
	.superRefine((snapshot, context) => {
		const { catalogue } = snapshot;
		const activeWorkspace = catalogue.workspaces.find(
			({ id }) => id === catalogue.active_workspace_id
		);
		if (snapshot.status === "no_active_workspace") {
			if (catalogue.active_workspace_id !== null)
				context.addIssue({
					code: "custom",
					message: "A no-active-workspace snapshot cannot have an active workspace",
				});
			return;
		}
		if (!activeWorkspace) {
			context.addIssue({
				code: "custom",
				message: "An active-workspace snapshot requires an active workspace",
			});
			return;
		}
		if (
			snapshot.status === "active_workspace_loaded" &&
			activeWorkspace.todo_path !== snapshot.todo_file.path
		) {
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
