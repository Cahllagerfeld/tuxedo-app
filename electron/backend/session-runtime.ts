import { Effect, Layer, ManagedRuntime } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Identity, identityLayer } from "./identity";
import {
	WorkspaceSession,
	sessionLayer,
	type SessionBackend,
	type SessionOperation,
	type SessionEffects,
} from "./session";
import type { TodoFileObservationAdapter } from "./observation";
import type { DesktopRequest, TodoFileChange } from "../../src/lib/shared/desktop/contract";
export type SessionDependencies = {
	filesystem?: FileSystem;
	identity?: Identity["Service"];
};

export function createSessionRuntime(
	cataloguePath: string,
	observation?: TodoFileObservationAdapter,
	onTodoFileChanged: (event: TodoFileChange) => void = () => {},
	dependencies: SessionDependencies = {}
) {
	const capabilities = Layer.merge(
		dependencies.filesystem
			? Layer.succeed(FileSystem, dependencies.filesystem)
			: NodeFileSystem.layer,
		dependencies.identity ? Layer.succeed(Identity, dependencies.identity) : identityLayer
	);
	const layer = sessionLayer(cataloguePath, observation, onTodoFileChanged).pipe(
		Layer.provideMerge(capabilities)
	);
	const runtime: ManagedRuntime.ManagedRuntime<WorkspaceSession | FileSystem | Identity, never> =
		ManagedRuntime.make(layer);
	return runtime;
}

export function desktopSessionBackend(
	runtime: ReturnType<typeof createSessionRuntime>
): SessionBackend & { dispose: () => Promise<void>; stopObservation: () => Promise<void> } {
	const run = <K extends SessionOperation>(operation: K, request: DesktopRequest<K>) =>
		runtime.runPromise(
			WorkspaceSession.use((session) => {
				const operations: SessionEffects = session;
				return operations[operation](request);
			}).pipe(Effect.uninterruptible)
		);
	return {
		readSession: (request) => run("readSession", request),
		restoreSession: (request) => run("restoreSession", request),
		createWorkspace: (request) => run("createWorkspace", request),
		switchWorkspace: (request) => run("switchWorkspace", request),
		deleteWorkspace: (request) => run("deleteWorkspace", request),
		createTodo: (request) => run("createTodo", request),
		editTodo: (request) => run("editTodo", request),
		setTodoCompletion: (request) => run("setTodoCompletion", request),
		deleteTodo: (request) => run("deleteTodo", request),
		reorderTodo: (request) => run("reorderTodo", request),
		stopObservation: () =>
			runtime.runPromise(WorkspaceSession.use((session) => session.stopObservation)),
		dispose: () => runtime.dispose(),
	};
}

export function createSessionBackend(
	cataloguePath: string,
	observation?: TodoFileObservationAdapter,
	onTodoFileChanged?: (event: TodoFileChange) => void,
	dependencies?: SessionDependencies
) {
	return desktopSessionBackend(
		createSessionRuntime(cataloguePath, observation, onTodoFileChanged, dependencies)
	);
}
