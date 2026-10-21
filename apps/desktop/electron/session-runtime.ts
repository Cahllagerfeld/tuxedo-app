import { Cause, Effect, Layer, ManagedRuntime } from "effect";
import { createApplicationRuntime } from "./application-runtime";
import { FileSystem } from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import {
	Identity,
	identityLayer,
	WorkspaceSession,
	workspaceSessionLayer,
	type SessionOperation,
	type SessionEffects,
	type TodoFileObservationAdapter,
} from "@tuxedo/backend";
import type { DesktopAPI, DesktopRequest, TodoFileChange } from "@tuxedo/contracts";

type SessionBackend = Omit<DesktopAPI, "selectTodoFile" | "writeClipboardText">;
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
	let shuttingDown = false;
	const capabilities = Layer.merge(
		dependencies.filesystem
			? Layer.succeed(FileSystem, dependencies.filesystem)
			: NodeFileSystem.layer,
		dependencies.identity ? Layer.succeed(Identity, dependencies.identity) : identityLayer
	);
	const layer = workspaceSessionLayer(
		cataloguePath,
		observation,
		onTodoFileChanged,
		() => shuttingDown
	).pipe(Layer.provide(capabilities));
	const runtime: ManagedRuntime.ManagedRuntime<WorkspaceSession, never> =
		ManagedRuntime.make(layer);
	return Object.assign(runtime, {
		stopAdmission: () => {
			shuttingDown = true;
		},
	});
}

export function desktopSessionBackend(runtime: ReturnType<typeof createSessionRuntime>) {
	const application = createApplicationRuntime<WorkspaceSession>(
		runtime,
		WorkspaceSession.use((session) => session.stopObservation),
		runtime.stopAdmission
	);
	const run = <K extends SessionOperation>(operation: K, request: DesktopRequest<K>) =>
		application.run(
			operation,
			WorkspaceSession.use((session) => {
				const operations: SessionEffects = session;
				return operations[operation](request);
			})
		);
	const backend: SessionBackend = {
		setWorkspaceShowDeferred: (request) => run("setWorkspaceShowDeferred", request),
		setWorkspaceSortOrder: (request) => run("setWorkspaceSortOrder", request),
		undoTodo: (request) => run("undoTodo", request),
		readSavedViews: (request) => run("readSavedViews", request),
		saveView: (request) => run("saveView", request),
		deleteView: (request) => run("deleteView", request),
		readSession: (request) => run("readSession", request),
		restoreSession: (request) => run("restoreSession", request),
		createWorkspace: (request) => run("createWorkspace", request),
		switchWorkspace: (request) => run("switchWorkspace", request),
		deleteWorkspace: (request) => run("deleteWorkspace", request),
		createTodo: (request) => run("createTodo", request),
		editTodo: (request) => run("editTodo", request),
		setTodoCompletion: (request) => run("setTodoCompletion", request),
		bulkSetTodoCompletion: (request) => run("bulkSetTodoCompletion", request),
		bulkDeleteTodos: (request) => run("bulkDeleteTodos", request),
		deleteTodo: (request) => run("deleteTodo", request),
		reorderTodo: (request) => run("reorderTodo", request),
	};
	return {
		...application,
		...backend,
		stopObservation: () =>
			application.run(
				"stopObservation",
				WorkspaceSession.use((session) => session.stopObservation).pipe(
					Effect.catchCause((cause) =>
						Effect.sync(() =>
							console.error("Workspace session observation stop failed", Cause.pretty(cause))
						)
					)
				)
			),
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
