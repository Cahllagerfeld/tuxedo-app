import type { TodoFile, TodoFileObservation } from "@tuxedo/contracts";
import type { WorkspaceRoutes } from "#lib/modules/workspace/state/workspace-commands.svelte.js";

const summary = (file: TodoFile | undefined) => JSON.stringify(file && [file.items, file.skipped]);

/** Invalidates the loaders showing a changed Todo file; `onInvalidated` reports a changed summary. */
export function observeTodoFileChanges(
	observation: TodoFileObservation,
	routes: Pick<WorkspaceRoutes, "session" | "workspace" | "destination" | "invalidate">,
	onInvalidated: (changed: boolean) => void
) {
	let listening = true;
	const stop = observation.onTodoFileChanged((event) => {
		const confirmed = routes.session()?.value;
		if (!confirmed || event.scope !== confirmed.scope) return;
		const destination = routes.destination();
		const active =
			confirmed.session.status !== "unavailable"
				? confirmed.session.catalogue.active_workspace_id
				: null;
		if (event.workspaceId !== active && event.workspaceId !== destination) return;
		const shown = () => {
			const data = routes.workspace();
			return data?.workspaceId === event.workspaceId ? data.value : undefined;
		};
		const before = shown();
		const revision =
			(destination === event.workspaceId ? before?.confirmation?.revision : undefined) ??
			confirmed.revision;
		if (event.revision <= revision) return;
		void routes.invalidate({ session: true, workspaceId: event.workspaceId }).then(() => {
			if (!listening) return;
			onInvalidated(
				routes.destination() === event.workspaceId &&
					summary(before?.todo_file) !== summary(shown()?.todo_file)
			);
		});
	});
	return () => {
		listening = false;
		stop();
	};
}
