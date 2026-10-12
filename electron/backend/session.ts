import { Cause, Context, Effect, Layer, Semaphore } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Identity } from "./identity";
import { createTodoOperations, type TodoOperation } from "./todo-operations";
import {
	createWorkspaceLifecycle,
	readContents,
	type LifecycleFailure,
	type LoadedSession,
} from "./workspace-lifecycle";
import type { TodoFileObservationAdapter } from "./observation";
import type {
	ConfirmedSession,
	DesktopAPI,
	DesktopRequest,
	DesktopResponse,
	TodoFileChange,
} from "../../src/lib/shared/desktop/contract";
export type SessionBackend = Omit<DesktopAPI, "selectTodoFile">;
export type SessionOperation = keyof SessionBackend;
type SessionEffects = {
	[K in SessionOperation]: (request: DesktopRequest<K>) => Effect.Effect<DesktopResponse<K>>;
};
export class WorkspaceSession extends Context.Service<WorkspaceSession, SessionEffects>()(
	"tuxedo/backend/WorkspaceSession"
) {}
export type SessionState = {
	readonly confirmed: ConfirmedSession | undefined;
	readonly todoContents: string | undefined;
	readonly read: Effect.Effect<ConfirmedSession>;
	accept: (loaded: LoadedSession) => ConfirmedSession;
};

export function sessionLayer(
	cataloguePath: string,
	observation: TodoFileObservationAdapter | undefined,
	onTodoFileChanged: (event: TodoFileChange) => void,
	runEffect: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>
) {
	return Layer.effect(
		WorkspaceSession,
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const identity = yield* Identity;
			const workspace = createWorkspaceLifecycle(cataloguePath, fs, identity);
			const semaphore = yield* Semaphore.make(1);
			const scope = identity.uuid();
			yield* Effect.addFinalizer(() => Effect.sync(() => observation?.stop()));
			let revision = 0;
			let confirmed: ConfirmedSession | undefined;
			let todoContents: string | undefined;
			let busy = false;
			const state: SessionState = {
				get confirmed() {
					return confirmed;
				},
				get todoContents() {
					return todoContents;
				},
				read: Effect.gen(function* () {
					if (!confirmed) state.accept(yield* workspace.load());
					return confirmed!;
				}),
				accept(loaded) {
					confirmed = { scope, revision: revision++, session: loaded.session };
					todoContents = loaded.todoContents;
					return confirmed;
				},
			};
			const diagnostic = (operation: string, cause: unknown) =>
				Effect.sync(() =>
					console.error(`Workspace session ${operation} failed unexpectedly`, cause)
				);
			const serialize = <A, E>(operation: string, effect: Effect.Effect<A, E>) =>
				semaphore.withPermit(
					Effect.gen(function* () {
						busy = true;
						return yield* effect;
					}).pipe(
						Effect.ensuring(
							Effect.sync(() => {
								busy = false;
								syncObservation();
							})
						),
						Effect.uninterruptible,
						Effect.withSpan(`WorkspaceSession.${operation}`)
					)
				);
			const syncObservation = () => {
				const current = confirmed;
				const ready = current?.session.status === "ready" ? current.session : null;
				try {
					observation?.retarget(ready?.todo_file.path ?? null, () => {
						if (busy || !current || !ready || current !== confirmed) return;
						void runEffect(
							serialize(
								"observe",
								Effect.gen(function* () {
									if (current !== confirmed) return;
									const contents = yield* readContents(fs, ready.todo_file.path).pipe(
										Effect.catchTag("PlatformError", () => Effect.succeed(undefined))
									);
									if (contents === todoContents) return;
									onTodoFileChanged({
										scope: current.scope,
										revision: current.revision,
										workspaceId: ready.catalogue.active_workspace_id!,
										todoPath: ready.todo_file.path,
									});
								})
							).pipe(Effect.catchCause((cause) => diagnostic("observe", Cause.pretty(cause))))
						);
					});
				} catch (cause) {
					// Observation stays best-effort even when a platform adapter fails.
					console.error("Workspace session observation failed", cause);
				}
			};
			const lifecycle = (
				operation: string,
				prefix: string,
				effect: Effect.Effect<LoadedSession, LifecycleFailure>
			) =>
				serialize(
					operation,
					effect.pipe(
						Effect.map((loaded) => ({
							status: "applied" as const,
							confirmed: state.accept(loaded),
						})),
						Effect.catch((error) =>
							Effect.succeed({ status: "rejected" as const, message: prefix + error.message })
						),
						Effect.catchDefect((cause) =>
							diagnostic(operation, cause).pipe(
								Effect.as({
									status: "rejected" as const,
									message: prefix + "An unexpected error occurred. Try again.",
								})
							)
						)
					)
				);
			const read = (operation: "readSession" | "restoreSession") =>
				serialize(
					operation,
					(operation === "readSession"
						? state.read
						: workspace.load().pipe(Effect.map(state.accept))
					).pipe(
						Effect.catchDefect((cause) =>
							Effect.gen(function* () {
								yield* diagnostic(operation, cause);
								if (confirmed) return confirmed;
								return state.accept({
									session: {
										status: "unavailable",
										error:
											"Cannot restore the Workspace session. An unexpected error occurred. Try again.",
									},
								});
							})
						)
					)
				);
			const todos = createTodoOperations(cataloguePath, fs, identity, state, runEffect);
			const todoOperation = <K extends TodoOperation>(operation: K, request: DesktopRequest<K>) =>
				serialize(
					operation,
					Effect.promise(() => todos[operation](request))
				);
			return WorkspaceSession.of({
				readSession: () => read("readSession"),
				restoreSession: () => read("restoreSession"),
				createWorkspace: (request) =>
					lifecycle(
						"createWorkspace",
						"Cannot create Workspace: ",
						workspace.createWorkspace(request)
					),
				switchWorkspace: (request) =>
					lifecycle(
						"switchWorkspace",
						"Cannot open Workspace: ",
						workspace.switchWorkspace(request)
					),
				deleteWorkspace: (request) =>
					lifecycle(
						"deleteWorkspace",
						"Cannot delete Workspace: ",
						workspace.deleteWorkspace(request)
					),
				createTodo: (request) => todoOperation("createTodo", request),
				editTodo: (request) => todoOperation("editTodo", request),
				deleteTodo: (request) => todoOperation("deleteTodo", request),
				setTodoCompletion: (request) => todoOperation("setTodoCompletion", request),
				reorderTodo: (request) => todoOperation("reorderTodo", request),
			});
		})
	);
}
