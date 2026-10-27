import type { DesktopAPI, DesktopRequest, TodoSortOrder } from "@tuxedo/contracts";
import type { WorkspaceCommandContext } from "./workspace-commands.svelte";
import type { WorkspaceSessionActionResult } from "./workspace-session-types";
import { CommandValidationError } from "./workspace-command-gate.svelte";

const activeWorkspaceId = (
	confirmed: Awaited<ReturnType<DesktopAPI["refreshSession"]>>
): string | null =>
	confirmed.session.status === "ready" ? confirmed.session.catalogue.active_workspace_id : null;

export function workspaceLifecycleCommands({
	desktop,
	gate,
	routes,
	reader,
}: WorkspaceCommandContext) {
	const destinationOrNull = (workspaceId: string | null) =>
		workspaceId === routes.destination() ? workspaceId : null;
	async function sessionOutcome(
		outcome: Awaited<ReturnType<DesktopAPI["createWorkspace"]>>
	): Promise<WorkspaceSessionActionResult> {
		if (outcome.status !== "applied") return outcome;
		reader.requireRevision(outcome.confirmed);
		const refreshed = await reader.refresh({
			workspaceId: destinationOrNull(activeWorkspaceId(outcome.confirmed)),
			session: true,
		});
		return {
			status: "applied",
			...(refreshed.status === "rejected"
				? { notice: "Change saved, but the Workspace could not be refreshed. " + refreshed.message }
				: {}),
		};
	}
	function catalogueTarget() {
		if (!reader.catalogue || reader.recoveryError)
			throw new CommandValidationError("Refresh Workspaces before changing them.");
	}

	return {
		retry: () =>
			gate.run("restore", async () => {
				const value = await desktop.refreshSession({});
				reader.requireRevision(value);
				const active = activeWorkspaceId(value);
				const outcome = await reader.refresh({
					workspaceId: destinationOrNull(active),
					session: true,
				});
				return outcome.status === "applied" ? { ...outcome, activeWorkspaceId: active } : outcome;
			}),
		activate: (workspaceId: string): Promise<WorkspaceSessionActionResult> =>
			gate.run(
				"open_workspace",
				async () => {
					if (reader.activeWorkspace?.id === workspaceId && reader.current?.value?.confirmation)
						return reader.refresh({ workspaceId, session: true });
					const outcome = await desktop.switchWorkspace({ workspaceId });
					if (outcome.status !== "applied") return outcome;
					reader.requireRevision(outcome.confirmed);
					return reader.refresh({ workspaceId: destinationOrNull(workspaceId), session: true });
				},
				{ target: { workspaceId }, committed: true }
			),
		create: (input: DesktopRequest<"createWorkspace">) =>
			gate.run(
				"create_workspace",
				async () => {
					catalogueTarget();
					const outcome = await desktop.createWorkspace(input);
					if (outcome.status !== "applied") return outcome;
					reader.requireRevision(outcome.confirmed);
					const id = activeWorkspaceId(outcome.confirmed);
					const refreshed = await reader.refresh({ session: true });
					return {
						status: "applied",
						workspaceId: id,
						...(refreshed.status === "rejected"
							? {
									notice:
										"Workspace created, but Workspaces could not be refreshed. " +
										refreshed.message,
								}
							: {}),
					};
				},
				{ target: { todoPath: input.todoPath } }
			),
		deleteWorkspace: (workspaceId: string) =>
			gate.run(
				"delete_workspace",
				async () => {
					catalogueTarget();
					const outcome = await desktop.deleteWorkspace({ workspaceId });
					if (outcome.status !== "applied") return outcome;
					const active = activeWorkspaceId(outcome.confirmed);
					return { ...(await sessionOutcome(outcome)), activeWorkspaceId: active };
				},
				{ target: { workspaceId } }
			),
		setSortOrder: (sortOrder: TodoSortOrder) =>
			gate.run(
				"set_workspace_sort_order",
				async () =>
					sessionOutcome(
						await desktop.setWorkspaceSortOrder({ ...reader.todoTarget(), sortOrder })
					),
				{ target: reader.todoOperationTarget() }
			),
		setShowDeferred: (showDeferred: boolean) =>
			gate.run(
				"set_workspace_show_deferred",
				async () =>
					sessionOutcome(
						await desktop.setWorkspaceShowDeferred({ ...reader.todoTarget(), showDeferred })
					),
				{ target: reader.todoOperationTarget() }
			),
	};
}
