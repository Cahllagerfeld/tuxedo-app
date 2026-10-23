import { Layer } from "effect";
import { sessionLayer } from "./session";
import { workspaceCatalogueLayer } from "./workspace-catalogue";
import type { TodoFileObservationAdapter } from "./observation";
import type { TodoFileChange } from "@tuxedo/contracts";

export { WorkspaceSession, type SessionOperation, type SessionEffects } from "./session";
export { Identity, identityLayer } from "./identity";
export type { TodoFileObservationAdapter } from "./observation";

// FileSystem and Identity are supplied once by the application or scoped test fixture.
export function workspaceSessionLayer(
	cataloguePath: string,
	observation?: TodoFileObservationAdapter,
	onTodoFileChanged: (event: TodoFileChange) => void = () => {},
	isShuttingDown: () => boolean = () => false
) {
	return sessionLayer(cataloguePath, observation, onTodoFileChanged, isShuttingDown).pipe(
		Layer.provide(workspaceCatalogueLayer(cataloguePath))
	);
}
