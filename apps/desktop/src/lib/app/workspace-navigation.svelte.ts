import { untrack } from "svelte";
import type { DesktopRequest, TodoFile } from "@tuxedo/contracts";
import type {
	WorkspaceCommands,
	WorkspaceRoutes,
} from "#lib/modules/workspace/state/workspace-commands.svelte.js";
import type { WorkspaceSessionActionResult } from "#lib/modules/workspace/state/workspace-session-types.js";
import { errorMessage } from "#lib/shared/utils.js";

type NavigationRoutes = Pick<WorkspaceRoutes, "session" | "workspace" | "destination"> & {
	navigate: (workspaceId: string | null, replace?: boolean) => Promise<void>;
};

const contents = (file: TodoFile) => JSON.stringify([file.items, file.skipped]);

export function workspaceNavigation(commands: WorkspaceCommands, routes: NavigationRoutes) {
	let starting = $state(true);
	let committing = $state(false);
	let destinationError = $state("");
	let generation = 0;
	let leaving: Promise<void> | undefined;
	const home = () =>
		(leaving ??= routes.navigate(null, true).finally(() => {
			leaving = undefined;
		}));
	const unavailable = () => {
		const id = routes.destination();
		const current = routes.workspace();
		return (
			!!id &&
			routes.session()?.value?.session.status === "empty" &&
			current?.workspaceId === id &&
			!!current.error
		);
	};
	async function leaveUnavailable() {
		const session = routes.session()?.value?.session;
		destinationError = session?.status === "empty" ? (session.warning ?? "") : "";
		try {
			await home();
		} catch (error) {
			destinationError = errorMessage(error);
		}
	}
	async function committedDestination(initial = false) {
		const admitted = ++generation;
		committing = true;
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
			if (!id) return;
			if (
				current?.workspaceId === id &&
				current.error &&
				(!current.value || session?.value?.session.status === "empty") &&
				!session?.error
			) {
				destinationError = current.error;
				await home();
				return;
			}
			if (commands.ready || commands.recoveryError) return;
			const outcome = await commands.activate(id);
			if (admitted !== generation) return;
			if (outcome.status === "rejected" && !commands.recoveryError) {
				destinationError = outcome.message;
				await home();
			} else if (outcome.status === "applied") destinationError = "";
		} catch (error) {
			destinationError = errorMessage(error);
		} finally {
			starting = false;
			if (admitted === generation) committing = false;
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
			await (id === null ? home() : routes.navigate(id, replace));
			return outcome;
		} catch (error) {
			return { status: "applied", notice: notice + errorMessage(error) };
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
		/**
		 * Reacts to loader data that changed outside a command or a committed navigation: a changed
		 * Todo file in the same Workspace calls `reloaded`, an unavailable destination returns Home.
		 * Call during component initialisation.
		 */
		followDisplayedData: (reloaded: () => void) => {
			let shown: { workspaceId: string; file: TodoFile } | undefined;
			$effect(() => {
				const workspaceId = routes.destination();
				const file = commands.todoFile;
				const idle = !commands.isOperating && !committing;
				const leave = idle && unavailable();
				untrack(() => {
					if (
						idle &&
						file &&
						shown &&
						shown.workspaceId === workspaceId &&
						contents(shown.file) !== contents(file)
					)
						reloaded();
					shown = workspaceId && file ? { workspaceId, file } : undefined;
					if (leave) void leaveUnavailable();
				});
			});
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
