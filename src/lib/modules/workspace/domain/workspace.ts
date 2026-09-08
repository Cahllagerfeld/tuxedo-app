import { z } from "zod";
import { todoFileSchema } from "$lib/modules/todo/domain/todo";
import type { TodoFile } from "$lib/modules/todo/domain/todo";

export type Workspace = {
	id: string;
	name: string;
	color: "blue" | "green" | "amber" | "red" | "violet" | "pink" | "cyan" | "orange";
	todo_path: string;
	created_at: string;
};

export type WorkspaceCatalogue = {
	version: 1;
	active_workspace_id: string | null;
	workspaces: Workspace[];
};

export type WorkspaceSessionSnapshot =
	| { status: "no_active_workspace"; catalogue: WorkspaceCatalogue }
	| {
			status: "active_workspace_loaded";
			catalogue: WorkspaceCatalogue;
			todo_file: TodoFile;
	  }
	| {
			status: "active_workspace_unavailable";
			catalogue: WorkspaceCatalogue;
			warning: string;
	  };

export type WorkspaceSessionOperationOutcome =
	| { outcome: "applied"; snapshot: WorkspaceSessionSnapshot }
	| { outcome: "conflict"; message: string; snapshot: WorkspaceSessionSnapshot }
	| { outcome: "rejected"; message: string };

export const workspaceSchema: z.ZodType<Workspace> = z.object({
	id: z.uuid(),
	name: z.string().min(1),
	color: z.enum(["blue", "green", "amber", "red", "violet", "pink", "cyan", "orange"]),
	todo_path: z.string(),
	created_at: z.iso.datetime({ offset: true }),
});

export const workspaceCatalogueSchema: z.ZodType<WorkspaceCatalogue> = z.object({
	version: z.literal(1),
	active_workspace_id: z.string().uuid().nullable(),
	workspaces: z.array(workspaceSchema),
});

export const workspaceSessionSnapshotSchema: z.ZodType<WorkspaceSessionSnapshot> = z
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

export const workspaceSessionOperationOutcomeSchema: z.ZodType<WorkspaceSessionOperationOutcome> =
	z.discriminatedUnion("outcome", [
		z
			.object({
				outcome: z.literal("applied"),
				snapshot: workspaceSessionSnapshotSchema,
			})
			.strict(),
		z
			.object({
				outcome: z.literal("conflict"),
				message: z.string().min(1),
				snapshot: workspaceSessionSnapshotSchema,
			})
			.strict(),
		z
			.object({
				outcome: z.literal("rejected"),
				message: z.string().min(1),
			})
			.strict(),
	]);
