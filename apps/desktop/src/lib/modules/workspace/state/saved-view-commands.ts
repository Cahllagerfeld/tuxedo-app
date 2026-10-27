import type { DesktopAPI, SavedViewFilterValues } from "@tuxedo/contracts";
import type { InvalidateDisplayedData } from "./invalidate-displayed-data";
import type { WorkspaceCommandGate } from "./workspace-command-gate.svelte";
import type { WorkspaceSessionActionResult } from "./workspace-session-types";
import type { SavedViewsData } from "./workspace-route-data";

export type SavedViewCommandContext = {
	readonly desktop: Pick<DesktopAPI, "saveView" | "deleteView">;
	readonly gate: WorkspaceCommandGate;
	/** The Todo-item reader is confirmed for writes. */
	readonly ready: () => boolean;
	/** The loader's saved views for the current destination. */
	readonly current: () => SavedViewsData | undefined;
	readonly workspaceId: () => string | undefined;
	readonly error: () => string;
	readonly invalidate: InvalidateDisplayedData;
	readonly setFailure: (failure: { workspaceId: string; message: string } | undefined) => void;
};

export function savedViewCommands(context: SavedViewCommandContext) {
	const { desktop, gate } = context;
	async function refresh(workspaceId: string): Promise<WorkspaceSessionActionResult> {
		try {
			await context.invalidate({ savedViewsId: workspaceId });
			const error = context.current()?.error;
			if (error) throw Error(error);
			context.setFailure(undefined);
			return { status: "applied" };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			context.setFailure({ workspaceId, message });
			return { status: "rejected", message };
		}
	}
	function write(
		operation: "save_view" | "delete_view",
		command: (workspaceId: string) => ReturnType<DesktopAPI["saveView"]>
	) {
		const workspaceId = context.workspaceId();
		return gate.run(
			operation,
			async () => {
				if (!workspaceId || !context.current() || context.error() || !context.ready())
					return { status: "rejected", message: "Refresh saved views before changing them." };
				try {
					const outcome = await command(workspaceId);
					if (outcome.status !== "applied") return outcome;
					if (outcome.workspaceId !== workspaceId)
						throw Error("Saved views belong to a different Workspace.");
					const refreshed = await refresh(workspaceId);
					return {
						status: "applied",
						...(refreshed.status === "rejected"
							? {
									notice:
										"Change saved, but saved views could not be refreshed. " + refreshed.message,
								}
							: {}),
					};
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					context.setFailure({ workspaceId, message });
					return { status: "rejected", message };
				}
			},
			{ target: workspaceId ? { workspaceId } : null }
		);
	}
	return {
		retry: () =>
			gate.run("refresh_saved_views", async () => {
				const workspaceId = context.workspaceId();
				return workspaceId
					? refresh(workspaceId)
					: { status: "rejected", message: "Open a Workspace first." };
			}),
		save: (name: string, filters: SavedViewFilterValues) =>
			write("save_view", (workspaceId) => desktop.saveView({ workspaceId, name, filters })),
		delete: (viewId: string) =>
			write("delete_view", (workspaceId) => desktop.deleteView({ workspaceId, viewId })),
	};
}
