import { z } from "zod";
export const workspaceSchema = z.strictObject({
	id: z.uuid(),
	name: z
		.string()
		.min(1)
		.refine((value) => value === value.trim(), "Workspace name must be trimmed"),
	color: z.enum(["blue", "green", "amber", "red", "violet", "pink", "cyan", "orange"]),
	todo_path: z
		.string()
		.refine((value) => value.trim().length > 0, "Todo-file path must not be empty"),
	created_at: z.iso.datetime({ offset: true }),
});
export const catalogueSchema = z
	.strictObject({
		version: z.literal(1),
		active_workspace_id: z.uuid().nullable(),
		workspaces: z.array(workspaceSchema),
	})
	.superRefine((catalogue, ctx) => {
		for (const field of ["id", "name", "todo_path"] as const) {
			const values = catalogue.workspaces.map((workspace) =>
				field === "name" ? workspace.name.toLowerCase() : workspace[field]
			);
			if (new Set(values).size !== values.length)
				ctx.addIssue({ code: "custom", message: `Duplicate Workspace ${field}` });
		}
		if (
			catalogue.active_workspace_id !== null &&
			!catalogue.workspaces.some((w) => w.id === catalogue.active_workspace_id)
		)
			ctx.addIssue({ code: "custom", message: "Active workspace is missing" });
	});
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
export const todoFileSchema = z.strictObject({
	path: z.string().min(1),
	items: z.array(todoItemSchema),
	skipped: z.array(
		z.strictObject({
			line_number: z.number().int().positive(),
			raw: z.string(),
			reason: z.string().min(1),
		})
	),
});
export type TodoFile = z.infer<typeof todoFileSchema>;
export const createWorkspaceRequestSchema = z.strictObject({
	name: z.string().trim().min(1),
	color: workspaceSchema.shape.color,
	todoPath: z
		.string()
		.refine((value) => value.trim().length > 0, "Todo-file path must not be empty"),
});
export const sessionSchema = z
	.discriminatedUnion("status", [
		z.strictObject({
			status: z.literal("ready"),
			catalogue: catalogueSchema,
			todo_file: todoFileSchema,
		}),
		z.strictObject({
			status: z.literal("empty"),
			catalogue: catalogueSchema,
			warning: z.string().nullable(),
		}),
		z.strictObject({ status: z.literal("unavailable"), error: z.string().min(1) }),
	])
	.superRefine((session, context) => {
		if (session.status !== "ready") return;
		const active = session.catalogue.workspaces.find(
			(w) => w.id === session.catalogue.active_workspace_id
		);
		if (!active || active.todo_path !== session.todo_file.path)
			context.addIssue({
				code: "custom",
				message: "Loaded Todo file must belong to the Active workspace",
			});
	});
export const confirmedSessionSchema = z.strictObject({
	scope: z.uuid(),
	revision: z.number().int().nonnegative(),
	session: sessionSchema,
});
export type ConfirmedSession = z.infer<typeof confirmedSessionSchema>;
export const sessionOutcomeSchema = z.discriminatedUnion("status", [
	z.strictObject({ status: z.literal("applied"), confirmed: confirmedSessionSchema }),
	z.strictObject({ status: z.literal("rejected"), message: z.string().min(1) }),
]);
export const deleteWorkspaceRequestSchema = z.strictObject({ workspaceId: z.uuid() });
export const desktopContract = {
	deleteWorkspace: {
		channel: "tuxedo:delete-workspace",
		request: deleteWorkspaceRequestSchema,
		response: sessionOutcomeSchema,
	},
	selectTodoFile: {
		channel: "tuxedo:select-todo-file",
		request: z.strictObject({}),
		response: z.string().min(1).nullable(),
	},
	createWorkspace: {
		channel: "tuxedo:create-workspace",
		request: createWorkspaceRequestSchema,
		response: sessionOutcomeSchema,
	},
	readSession: {
		channel: "tuxedo:read-session",
		request: z.strictObject({}),
		response: confirmedSessionSchema,
	},
	restoreSession: {
		channel: "tuxedo:restore-session",
		request: z.strictObject({}),
		response: confirmedSessionSchema,
	},
} as const;
export type DesktopOperation = keyof typeof desktopContract;
export type DesktopRequest<K extends DesktopOperation> = keyof z.infer<
	(typeof desktopContract)[K]["request"]
> extends never
	? Record<string, never>
	: z.infer<(typeof desktopContract)[K]["request"]>;
export type DesktopAPI = {
	[K in DesktopOperation]: (
		request: DesktopRequest<K>
	) => Promise<z.infer<(typeof desktopContract)[K]["response"]>>;
};
export function createDesktopClient(
	invoke: (channel: string, request: unknown) => Promise<unknown>
): DesktopAPI {
	const call = async <K extends DesktopOperation>(
		operation: K,
		request: DesktopRequest<K>
	): Promise<z.infer<(typeof desktopContract)[K]["response"]>> => {
		const contract = desktopContract[operation];
		return contract.response.parse(
			await invoke(contract.channel, contract.request.parse(request))
		) as z.infer<(typeof desktopContract)[K]["response"]>;
	};
	return {
		deleteWorkspace: (request) => call("deleteWorkspace", request),
		selectTodoFile: (request) => call("selectTodoFile", request),
		createWorkspace: (request) => call("createWorkspace", request),
		readSession: (request) => call("readSession", request),
		restoreSession: (request) => call("restoreSession", request),
	};
}
declare global {
	interface Window {
		desktop?: DesktopAPI;
	}
}
