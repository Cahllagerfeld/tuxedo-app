import type { ConfirmedSession, DesktopRequest, TodoSortOrder } from "@tuxedo/contracts";
import type { WorkspaceCommandContext } from "./workspace-commands.svelte";
import type { DisplayedDataTarget } from "./invalidate-displayed-data";
import type { WorkspaceSessionActionResult } from "./workspace-session-types";
import { CommandValidationError } from "./workspace-command-gate.svelte";

const activeWorkspaceId = (confirmed: ConfirmedSession): string | null =>
	confirmed.session.status === "ready" ? confirmed.session.catalogue.active_workspace_id : null;

export function workspaceLifecycleCommands({
	desktop,
	gate,
	routes,
	reader,
}: WorkspaceCommandContext) {
	const destinationOrNull = (workspaceId: string | null) =>
		workspaceId === routes.destination() ? workspaceId : null;
	async function invalidate(
		target: DisplayedDataTarget,
		notice: string,
		applied: Extract<WorkspaceSessionActionResult, { status: "applied" }> = { status: "applied" }
	): Promise<WorkspaceSessionActionResult> {
		const refreshed = await reader.refresh(target);
		return refreshed.status === "rejected"
			? { ...applied, notice: notice + refreshed.message }
			: applied;
	}
	function requireCatalogue() {
		if (!reader.catalogue || reader.recoveryError)
			throw new CommandValidationError("Refresh Workspaces before changing them.");
	}
	async function setPreference(
		write: (
			target: ReturnType<typeof reader.todoTarget>
		) => ReturnType<typeof desktop.setWorkspaceSortOrder>
	) {
		const target = reader.todoTarget();
		const outcome = await write(target);
		if (outcome.status !== "applied") return outcome;
		return invalidate(
			{ session: true, workspaceId: target.workspaceId },
			"Change saved, but the Workspace could not be refreshed. "
		);
	}

	return {
		retry: () =>
			gate.run("restore", async () => {
				const active = activeWorkspaceId(await desktop.refreshSession({}));
				const outcome = await reader.refresh({
					session: true,
					workspaceId: destinationOrNull(active),
				});
				return outcome.status === "applied" ? { ...outcome, activeWorkspaceId: active } : outcome;
			}),
		activate: (workspaceId: string): Promise<WorkspaceSessionActionResult> =>
			gate.run(
				"open_workspace",
				async () => {
					if (reader.activeWorkspace?.id !== workspaceId || !reader.current?.value?.confirmation) {
						const outcome = await desktop.switchWorkspace({ workspaceId });
						if (outcome.status !== "applied") return outcome;
					}
					return reader.refresh({ session: true, workspaceId: destinationOrNull(workspaceId) });
				},
				{ target: { workspaceId }, committed: true }
			),
		create: (input: DesktopRequest<"createWorkspace">) =>
			gate.run(
				"create_workspace",
				async () => {
					requireCatalogue();
					const outcome = await desktop.createWorkspace(input);
					if (outcome.status !== "applied") return outcome;
					return invalidate(
						{ session: true },
						"Workspace created, but Workspaces could not be refreshed. ",
						{ status: "applied", workspaceId: activeWorkspaceId(outcome.confirmed) }
					);
				},
				{ target: { todoPath: input.todoPath } }
			),
		deleteWorkspace: (workspaceId: string) =>
			gate.run(
				"delete_workspace",
				async () => {
					requireCatalogue();
					const outcome = await desktop.deleteWorkspace({ workspaceId });
					if (outcome.status !== "applied") return outcome;
					const active = activeWorkspaceId(outcome.confirmed);
					return invalidate(
						{ session: true, workspaceId: destinationOrNull(active) },
						"Workspace removed, but Workspaces could not be refreshed. ",
						{ status: "applied", activeWorkspaceId: active }
					);
				},
				{ target: { workspaceId } }
			),
		setSortOrder: (sortOrder: TodoSortOrder) =>
			gate.run(
				"set_workspace_sort_order",
				() => setPreference((target) => desktop.setWorkspaceSortOrder({ ...target, sortOrder })),
				{ target: reader.todoOperationTarget() }
			),
		setShowDeferred: (showDeferred: boolean) =>
			gate.run(
				"set_workspace_show_deferred",
				() =>
					setPreference((target) => desktop.setWorkspaceShowDeferred({ ...target, showDeferred })),
				{ target: reader.todoOperationTarget() }
			),
	};
}
