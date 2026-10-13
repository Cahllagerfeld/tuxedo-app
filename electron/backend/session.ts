import { Cause, Context, Effect, Exit, Layer, Queue, Scope, Semaphore, Stream } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Identity } from "./identity";
import { createTodoOperations } from "./todo-operations";
import {
	createWorkspaceLifecycle,
	readContents,
	type OperationError,
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
export type SessionEffects = {
	[K in SessionOperation]: (
		request: DesktopRequest<K>
	) => Effect.Effect<DesktopResponse<K>, never, FileSystem | Identity>;
};
export class WorkspaceSession extends Context.Service<
	WorkspaceSession,
	SessionEffects & {
		stopObservation: Effect.Effect<void>;
	}
>()("tuxedo/backend/WorkspaceSession") {}
export type SessionState = {
	readonly todoContents: string | undefined;
	readonly read: Effect.Effect<ConfirmedSession, never, FileSystem>;
	accept: (loaded: LoadedSession) => ConfirmedSession;
};

export function sessionLayer(
	cataloguePath: string,
	observation: TodoFileObservationAdapter | undefined,
	onTodoFileChanged: (event: TodoFileChange) => void
) {
	return Layer.effect(
		WorkspaceSession,
		Effect.gen(function* () {
			const identity = yield* Identity;
			const workspace = createWorkspaceLifecycle(cataloguePath);
			const semaphore = yield* Semaphore.make(1);
			const scope = identity.uuid();
			let observed: { current: ConfirmedSession; scope: Scope.Closeable } | undefined;
			let revision = 0;
			let confirmed: ConfirmedSession | undefined;
			let todoContents: string | undefined;
			let busy = false;
			const state: SessionState = {
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
				console.error(`Workspace session ${operation} failed unexpectedly`, cause);
			const serialize = <A, E>(
				operation: string,
				effect: Effect.Effect<A, E, FileSystem | Identity>
			): Effect.Effect<A, E, FileSystem | Identity> =>
				semaphore.withPermit(
					Effect.gen(function* () {
						busy = true;
						return yield* effect;
					}).pipe(
						Effect.ensuring(
							Effect.gen(function* () {
								yield* syncObservation;
								busy = false;
							})
						),
						Effect.uninterruptible,
						Effect.withSpan(`WorkspaceSession.${operation}`)
					)
				);
			const closeObservation = Effect.gen(function* () {
				const previous = observed;
				observed = undefined;
				if (previous)
					yield* Scope.close(previous.scope, Exit.void).pipe(
						Effect.catchCause((cause) =>
							Effect.sync(() => diagnostic("observation release", Cause.pretty(cause)))
						)
					);
			});
			yield* Effect.addFinalizer(() => closeObservation);
			const syncObservation: Effect.Effect<void, never, FileSystem | Identity> = Effect.gen(
				function* () {
					if (!observation || observed?.current === confirmed) return;
					yield* closeObservation;
					const current = confirmed;
					if (!current || current.session.status !== "ready") return;
					const ready = current.session;
					const targetScope = yield* Scope.make();
					observed = { current, scope: targetScope };
					const refresh = Effect.suspend(() => {
						if (busy || current !== confirmed || observed?.scope !== targetScope)
							return Effect.void;
						return serialize(
							"observe",
							Effect.gen(function* () {
								if (current !== confirmed || observed?.scope !== targetScope) return;
								const contents = yield* readContents(ready.todo_file.path).pipe(
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
						).pipe(
							Effect.catchCause((cause) =>
								Effect.sync(() => diagnostic("observe", Cause.pretty(cause)))
							)
						);
					});
					yield* Effect.gen(function* () {
						const signals = yield* Effect.acquireRelease(Queue.unbounded<void>(), Queue.shutdown);
						yield* observation.observe(ready.todo_file.path, () => {
							if (observed?.scope === targetScope) Queue.offerUnsafe(signals, undefined);
						});
						yield* Stream.fromQueue(signals).pipe(
							Stream.debounce("250 millis"),
							Stream.runForEach(() => refresh),
							Effect.interruptible,
							Effect.forkScoped
						);
					}).pipe(
						Scope.provide(targetScope),
						Effect.catchCause((cause) =>
							Effect.gen(function* () {
								yield* closeObservation;
								diagnostic("observation", Cause.pretty(cause));
							})
						)
					);
				}
			);
			const operation = <A>(
				name: string,
				prefix: string,
				effect: Effect.Effect<A, OperationError, FileSystem | Identity>
			) =>
				serialize(
					name,
					effect.pipe(
						Effect.catch((error) =>
							Effect.succeed({ status: "rejected" as const, message: prefix + error.message })
						),
						Effect.catchDefect((cause) =>
							Effect.sync(() => {
								diagnostic(name, cause);
								return {
									status: "rejected" as const,
									message: prefix + "An unexpected error occurred. Try again.",
								};
							})
						)
					)
				);
			const applied = (loaded: LoadedSession) => ({
				status: "applied" as const,
				confirmed: state.accept(loaded),
			});
			const read = (operation: "readSession" | "restoreSession") =>
				serialize(
					operation,
					(operation === "readSession"
						? state.read
						: workspace.load().pipe(Effect.map(state.accept))
					).pipe(
						Effect.catchDefect((cause) =>
							Effect.sync(() => {
								diagnostic(operation, cause);
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
			const todos = createTodoOperations(cataloguePath, state);
			return WorkspaceSession.of({
				stopObservation: semaphore.withPermit(closeObservation),
				readSession: () => read("readSession"),
				restoreSession: () => read("restoreSession"),
				createWorkspace: (request) =>
					operation(
						"createWorkspace",
						"Cannot create Workspace: ",
						workspace.createWorkspace(request).pipe(Effect.map(applied))
					),
				switchWorkspace: (request) =>
					operation(
						"switchWorkspace",
						"Cannot open Workspace: ",
						workspace.switchWorkspace(request).pipe(Effect.map(applied))
					),
				deleteWorkspace: (request) =>
					operation(
						"deleteWorkspace",
						"Cannot delete Workspace: ",
						workspace.deleteWorkspace(request).pipe(Effect.map(applied))
					),
				createTodo: (request) =>
					operation("createTodo", "Cannot create Todo item: ", todos.createTodo(request)),
				editTodo: (request) =>
					operation("editTodo", "Cannot edit Todo item: ", todos.editTodo(request)),
				deleteTodo: (request) =>
					operation("deleteTodo", "Cannot delete Todo item: ", todos.deleteTodo(request)),
				setTodoCompletion: (request) =>
					operation("setTodoCompletion", "", todos.setTodoCompletion(request)),
				reorderTodo: (request) =>
					operation("reorderTodo", "Cannot reorder Todo items: ", todos.reorderTodo(request)),
			});
		})
	);
}
