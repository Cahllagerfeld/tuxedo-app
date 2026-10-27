import type { DesktopAPI, SavedViewFilterValues } from "@tuxedo/contracts";
import type { InvalidateDisplayedData } from "./invalidate-displayed-data";
import { CommandValidationError, type WorkspaceCommandGate } from "./workspace-command-gate.svelte";
import type { WorkspaceSessionActionResult } from "./workspace-session-types";

export type SavedViewCommandContext = {
	readonly desktop: Pick<DesktopAPI, "saveView" | "deleteView">;
	readonly gate: WorkspaceCommandGate;
	readonly invalidate: InvalidateDisplayedData;
	/** The current destination Workspace. */
	readonly workspaceId: () => string | undefined;
	/** The loader holds the destination's views without errors and the Todo reader is ready. */
	readonly writable: () => boolean;
	/** The loader's read error for the destination's saved views. */
	readonly readError: () => string;
	/** Records a write's lost response or failed refresh; no message clears that Workspace's failure. */
	readonly setFailure: (workspaceId: string, message?: string) => void;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function savedViewCommands(context: SavedViewCommandContext) {
	const { desktop, gate } = context;
	async function read(workspaceId: string) {
		await context.invalidate({ savedViewsId: workspaceId });
		const error = context.readError();
		if (error) throw Error(error);
	}
	function fail(workspaceId: string, error: unknown) {
		context.setFailure(workspaceId, message(error));
		return message(error);
	}
	function write(
		operation: "save_view" | "delete_view",
		command: (workspaceId: string) => ReturnType<DesktopAPI["saveView"]>
	) {
		const workspaceId = context.workspaceId();
		return gate.run(
			operation,
			async (): Promise<WorkspaceSessionActionResult> => {
				if (!workspaceId || !context.writable())
					throw new CommandValidationError("Refresh saved views before changing them.");
				let outcome;
				try {
					outcome = await command(workspaceId);
				} catch (error) {
					return { status: "rejected", message: fail(workspaceId, error) };
				}
				if (outcome.status !== "applied") return outcome;
				try {
					await read(workspaceId);
					return { status: "applied" };
				} catch (error) {
					return {
						status: "applied",
						notice:
							"Change saved, but saved views could not be refreshed. " + fail(workspaceId, error),
					};
				}
			},
			{ target: workspaceId ? { workspaceId } : null }
		);
	}
	return {
		retry: () =>
			gate.run("refresh_saved_views", async () => {
				const workspaceId = context.workspaceId();
				if (!workspaceId) throw new CommandValidationError("Open a Workspace first.");
				try {
					await read(workspaceId);
				} catch (error) {
					return { status: "rejected", message: message(error) };
				}
				context.setFailure(workspaceId);
				return { status: "applied" };
			}),
		save: (name: string, filters: SavedViewFilterValues) =>
			write("save_view", (workspaceId) => desktop.saveView({ workspaceId, name, filters })),
		delete: (viewId: string) =>
			write("delete_view", (workspaceId) => desktop.deleteView({ workspaceId, viewId })),
	};
}
