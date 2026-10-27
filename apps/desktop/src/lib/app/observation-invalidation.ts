import type { TodoFileObservation } from "@tuxedo/contracts";
import type { InvalidateDisplayedData } from "#lib/modules/workspace/state/invalidate-displayed-data.js";

/** Invalidates the loaders that may display a changed Todo file. */
export const observeTodoFileChanges = (
	observation: TodoFileObservation,
	invalidate: InvalidateDisplayedData
) =>
	observation.onTodoFileChanged(({ workspaceId }) => {
		void invalidate({ session: true, workspaceId });
	});
