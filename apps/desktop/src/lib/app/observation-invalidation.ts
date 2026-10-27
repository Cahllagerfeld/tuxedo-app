import { todoFileChangeEvent } from "@tuxedo/contracts";
import type { TodoFileChange, TodoFileObservation } from "@tuxedo/contracts";
import type {
	WorkspaceCommands,
	WorkspaceRoutes,
} from "#lib/modules/workspace/state/workspace-commands.svelte.js";
import type { WorkspaceSessionActionResult } from "#lib/modules/workspace/state/workspace-session-types.js";

export function observationInvalidation(
	commands: WorkspaceCommands,
	routes: Pick<WorkspaceRoutes, "destination" | "navigating">
) {
	const { gate } = commands;
	const summary = () =>
		JSON.stringify({ items: commands.todoFile?.items, skipped: commands.todoFile?.skipped });
	let dirty:
		{ event: TodoFileChange; before: string; notify: (changed: boolean) => void } | undefined;
	const matches = (event: TodoFileChange) =>
		!!commands.confirmed &&
		event.scope === commands.confirmed.scope &&
		event.workspaceId === commands.activeWorkspace?.id &&
		event.todoPath === commands.activeWorkspace.todo_path;
	function drain(committed = false): Promise<WorkspaceSessionActionResult> | undefined {
		if (gate.isPending || (!committed && routes.navigating()) || !dirty) return;
		const { event, before, notify } = dirty;
		dirty = undefined;
		if (!matches(event)) return;
		const revision = commands.current?.value?.confirmation?.revision;
		if (commands.ready && revision !== undefined && revision >= event.revision) {
			notify(!!routes.destination() && before !== summary());
			return;
		}
		return gate
			.run(
				"restore",
				async () => {
					commands.requireRevision(event);
					return commands.refresh({ workspaceId: routes.destination() ?? null, session: true });
				},
				{ target: { workspaceId: event.workspaceId }, committed }
			)
			.then((outcome) => {
				notify(outcome.status === "applied" && !!routes.destination() && before !== summary());
				return outcome;
			});
	}
	const stopSettled = gate.onSettled(() => void drain());
	return {
		observe(observation: TodoFileObservation, onUpdated: (changed: boolean) => void) {
			let listening = true;
			const stop = observation.onTodoFileChanged((event) => {
				const parsed = todoFileChangeEvent.payload.safeParse(event);
				const confirmed = commands.confirmed;
				if (!listening || !parsed.success || !confirmed || parsed.data.scope !== confirmed.scope)
					return;
				const revision = commands.current?.value?.confirmation?.revision ?? confirmed.revision;
				if (parsed.data.revision <= revision) return;
				if (!gate.isPending && !routes.navigating() && !matches(parsed.data)) return;
				if (!dirty || parsed.data.revision >= dirty.event.revision)
					dirty = {
						event: parsed.data,
						before: dirty?.before ?? summary(),
						notify: (changed) => {
							if (listening) onUpdated(changed);
						},
					};
				void drain();
			});
			return () => {
				listening = false;
				dirty = undefined;
				stopSettled();
				stop();
			};
		},
		flush: () => drain(true),
	};
}
