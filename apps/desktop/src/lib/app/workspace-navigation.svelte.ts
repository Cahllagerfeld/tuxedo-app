import type { DesktopRequest } from "@tuxedo/contracts";
import type {
	WorkspaceCommands,
	WorkspaceRoutes,
} from "#lib/modules/workspace/state/workspace-commands.svelte.js";
import type { WorkspaceSessionActionResult } from "#lib/modules/workspace/state/workspace-session-types.js";

type NavigationRoutes = Pick<WorkspaceRoutes, "session" | "workspace" | "destination"> & {
	navigate: (workspaceId: string | null, replace?: boolean) => Promise<void>;
};

export function workspaceNavigation(commands: WorkspaceCommands, routes: NavigationRoutes) {
	let starting = $state(true);
	let destinationError = $state("");
	let generation = 0;
	const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
	async function committedDestination(initial = false) {
		const admitted = ++generation;
		await commands.whenIdle();
		if (admitted !== generation) return;
		const id = routes.destination();
		const session = routes.session();
		const current = routes.workspace();
		try {
			if (initial && !id && session?.value?.session.status === "ready") {
				const active = session.value.session.catalogue.active_workspace_id;
				if (active) await routes.navigate(active, true);
				return;
			}
			if (!id) {
				await commands.flushObservation();
				return;
			}
			if (
				current?.workspaceId === id &&
				current.error &&
				(!current.value || session?.value?.session.status === "empty") &&
				!session?.error
			) {
				destinationError = current.error;
				await routes.navigate(null, true);
				return;
			}
			if (commands.ready) {
				await commands.flushObservation();
				return;
			}
			if (commands.recoveryError) return;
			const outcome = await commands.activate(id);
			if (admitted !== generation) return;
			if (outcome.status === "rejected" && !commands.recoveryError) {
				destinationError = outcome.message;
				await routes.navigate(null, true);
			} else if (outcome.status === "applied") destinationError = "";
		} catch (error) {
			destinationError = message(error);
		} finally {
			starting = false;
		}
	}
	async function follow(
		action: () => Promise<WorkspaceSessionActionResult>,
		target: (
			outcome: Extract<WorkspaceSessionActionResult, { status: "applied" }>
		) => string | null | undefined,
		replace: boolean,
		notice: string
	): Promise<WorkspaceSessionActionResult> {
		const admitted = generation;
		const outcome = await action();
		if (outcome.status !== "applied") return outcome;
		await commands.whenIdle();
		if (admitted !== generation) return outcome;
		const id = target(outcome);
		if (id === undefined) return outcome;
		destinationError = "";
		try {
			await routes.navigate(id, replace);
			return outcome;
		} catch (error) {
			return { status: "applied", notice: notice + message(error) };
		}
	}
	return {
		get isStarting() {
			return starting;
		},
		get destinationError() {
			return destinationError;
		},
		committedDestination,
		observed: async (_changed: boolean) => {
			await commands.whenIdle();
			const session = routes.session()?.value?.session;
			const current = routes.workspace();
			if (
				routes.destination() &&
				session?.status === "empty" &&
				current &&
				current.workspaceId === routes.destination() &&
				current.error
			) {
				destinationError = session.warning ?? "";
				try {
					await routes.navigate(null, true);
				} catch (error) {
					destinationError = message(error);
				}
			}
		},
		create: (input: DesktopRequest<"createWorkspace">) =>
			follow(
				() => commands.create(input),
				(outcome) => outcome.workspaceId,
				false,
				"Workspace created, but its destination could not be opened. "
			),
		deleteWorkspace: (id: string) =>
			follow(
				() => commands.deleteWorkspace(id),
				(outcome) =>
					routes.destination() && outcome.activeWorkspaceId !== routes.destination()
						? null
						: undefined,
				true,
				"Workspace removed, but its destination could not be opened. "
			),
		retry: () =>
			follow(
				commands.retry,
				(outcome) =>
					routes.destination() && outcome.activeWorkspaceId !== routes.destination()
						? (outcome.activeWorkspaceId ?? null)
						: undefined,
				true,
				"Workspaces refreshed, but the destination could not be opened. "
			),
	};
}
