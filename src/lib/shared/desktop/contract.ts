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
export const sessionSchema = z.discriminatedUnion("status", [
	z.strictObject({
		status: z.literal("empty"),
		catalogue: catalogueSchema,
		warning: z.string().nullable(),
	}),
	z.strictObject({ status: z.literal("unavailable"), error: z.string().min(1) }),
]);
export const confirmedSessionSchema = z.strictObject({
	scope: z.uuid(),
	revision: z.number().int().nonnegative(),
	session: sessionSchema,
});
export type ConfirmedSession = z.infer<typeof confirmedSessionSchema>;
export const desktopContract = {
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
	const call = async (operation: DesktopOperation, request: unknown) => {
		const contract = desktopContract[operation];
		return contract.response.parse(await invoke(contract.channel, contract.request.parse(request)));
	};
	return {
		readSession: (request) => call("readSession", request),
		restoreSession: (request) => call("restoreSession", request),
	};
}
declare global {
	interface Window {
		desktop?: DesktopAPI;
	}
}
