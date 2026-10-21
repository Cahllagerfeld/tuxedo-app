import { Cause, Context, Effect, Exit, Layer, Queue, Scope, Semaphore, Stream } from "effect";
import { FileSystem } from "effect/FileSystem";
import { dirname, join } from "node:path";
import { createWorkspaceReads } from "./workspace-reads";
import { createSavedViewOperations } from "./saved-views";
import { Identity } from "./identity";
import { createTodoOperations } from "./todo-operations";
import { createWorkspaceLifecycle, type LoadedSession } from "./workspace-lifecycle";
import { readContents, type OperationError } from "./operation";
import { WorkspaceCatalogue } from "./workspace-catalogue";
import type { TodoFileObservationAdapter } from "./observation";
import type {
	ConfirmedSession,
	DesktopOperation,
	DesktopRequest,
	DesktopResponse,
	TodoFileChange,
	UndoLabel,
} from "@tuxedo/contracts";
export type SessionOperation = Exclude<DesktopOperation, "selectTodoFile" | "writeClipboardText">;
export type SessionEffects = {
	[K in SessionOperation]: (request: DesktopRequest<K>) => Effect.Effect<DesktopResponse<K>>;
};
export class WorkspaceSession extends Context.Service<
	WorkspaceSession,
	SessionEffects & {
		stopObservation: Effect.Effect<void>;
	}
>()("tuxedo/backend/WorkspaceSession") {}
export type UndoChange = { contents: string; label: UndoLabel };
export type SessionState = {
	readonly todoContents: string | undefined;
	readonly undo: UndoChange | undefined;
	readonly read: Effect.Effect<ConfirmedSession, never, FileSystem | WorkspaceCatalogue>;
	accept: (loaded: LoadedSession, undo?: UndoChange | null) => ConfirmedSession;
};

export function sessionLayer(
	cataloguePath: string,
	observation: TodoFileObservationAdapter | undefined,
	onTodoFileChanged: (event: TodoFileChange) => void,
	isShuttingDown: () => boolean = () => false
) {
	return Layer.effect(
		WorkspaceSession,
		Effect.gen(function* () {
			const identity = yield* Identity;
			const sessionScope = yield* Effect.scope;
			const dependencies = Context.make(FileSystem, yield* FileSystem).pipe(
				Context.add(Identity, identity),
				Context.add(WorkspaceCatalogue, yield* WorkspaceCatalogue)
			);
			const workspace = createWorkspaceLifecycle(cataloguePath);
			const semaphore = yield* Semaphore.make(1);
			const scope = identity.uuid();
			let observed: { current: ConfirmedSession; scope: Scope.Closeable } | undefined;
			let observationDisposed = false;
			let revision = 0;
			let confirmed: ConfirmedSession | undefined;
			let todoContents: string | undefined;
			let undo: UndoChange | undefined;
			const state: SessionState = {
				get undo() {
					return undo;
				},
				get todoContents() {
					return todoContents;
				},
				read: Effect.gen(function* () {
					if (!confirmed) state.accept(yield* workspace.load());
					return confirmed!;
				}),
				accept(loaded, nextUndo) {
					const sameFile =
						confirmed?.session.status === "ready" &&
						loaded.session.status === "ready" &&
						confirmed.session.catalogue.active_workspace_id ===
							loaded.session.catalogue.active_workspace_id &&
						confirmed.session.todo_file.path === loaded.session.todo_file.path &&
						todoContents === loaded.todoContents;
					undo = nextUndo === undefined ? (sameFile ? undo : undefined) : (nextUndo ?? undefined);
					confirmed = {
						scope,
						revision: revision++,
						session: loaded.session,
						...(undo ? { undoLabel: undo.label } : {}),
					};
					todoContents = loaded.todoContents;
					return confirmed;
				},
			};
			const diagnostic = (operation: string, cause: unknown) =>
				console.error(`Workspace session ${operation} failed unexpectedly`, cause);
			const serialize = <A, E>(
				operation: string,
				effect: Effect.Effect<A, E, FileSystem | Identity | WorkspaceCatalogue>
			): Effect.Effect<A, E> =>
				semaphore
					.withPermit(
						effect.pipe(
							Effect.ensuring(syncObservation),
							Effect.uninterruptible,
							Effect.withSpan(`WorkspaceSession.${operation}`)
						)
					)
					.pipe(Effect.provideContext(dependencies));
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
			yield* Effect.addFinalizer(() =>
				Effect.gen(function* () {
					observationDisposed = true;
					yield* closeObservation;
				})
			);
			const syncObservation: Effect.Effect<void, never, FileSystem | Identity> = Effect.gen(
				function* () {
					if (
						!observation ||
						observationDisposed ||
						isShuttingDown() ||
						observed?.current === confirmed
					)
						return;
					const previous = observed?.current.session;
					if (
						previous?.status === "ready" &&
						confirmed?.session.status === "ready" &&
						previous.catalogue.active_workspace_id ===
							confirmed.session.catalogue.active_workspace_id &&
						previous.todo_file.path === confirmed.session.todo_file.path
					) {
						observed!.current = confirmed;
						return;
					}
					yield* closeObservation;
					const current = confirmed;
					if (!current || current.session.status !== "ready") return;
					const ready = current.session;
					const targetScope = yield* Scope.make();
					observed = { current, scope: targetScope };
					let dirty = false;
					let refreshing = false;
					const matchesTarget = () =>
						!isShuttingDown() &&
						observed?.scope === targetScope &&
						confirmed?.session.status === "ready" &&
						confirmed.session.catalogue.active_workspace_id ===
							ready.catalogue.active_workspace_id &&
						confirmed.session.todo_file.path === ready.todo_file.path;
					const refresh = Effect.suspend(() => {
						if (!matchesTarget()) return Effect.void;
						dirty = true;
						if (refreshing) return Effect.void;
						refreshing = true;
						// Work belongs to the session Scope: entering Empty can close its own observer Scope.
						return Effect.gen(function* () {
							while (dirty && matchesTarget()) {
								yield* serialize(
									"observe",
									Effect.gen(function* () {
										if (!matchesTarget()) return;
										dirty = false;
										const contents = yield* readContents(ready.todo_file.path).pipe(
											Effect.catchTag("PlatformError", () => Effect.succeed(undefined))
										);
										if (!matchesTarget() || contents === todoContents) return;
										const accepted = state.accept(yield* workspace.load());
										if (isShuttingDown() || observed?.scope !== targetScope) return;
										onTodoFileChanged({
											scope: accepted.scope,
											revision: accepted.revision,
											workspaceId: ready.catalogue.active_workspace_id!,
											todoPath: ready.todo_file.path,
										});
									})
								);
							}
						}).pipe(
							Effect.catchCause((cause) =>
								Effect.sync(() => diagnostic("observe", Cause.pretty(cause)))
							),
							Effect.ensuring(
								Effect.sync(() => {
									refreshing = false;
								})
							),
							Effect.forkIn(sessionScope),
							Effect.asVoid
						);
					});
					yield* Effect.gen(function* () {
						const signals = yield* Effect.acquireRelease(Queue.unbounded<void>(), Queue.shutdown);
						yield* observation.observe(ready.todo_file.path, () => {
							if (!isShuttingDown() && observed?.scope === targetScope)
								Queue.offerUnsafe(signals, undefined);
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
			const operationResult = <A>(
				name: string,
				prefix: string,
				effect: Effect.Effect<A, OperationError, FileSystem | Identity | WorkspaceCatalogue>
			) =>
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
				);
			const operation = <A>(
				name: string,
				prefix: string,
				effect: Effect.Effect<A, OperationError, FileSystem | Identity | WorkspaceCatalogue>
			) => serialize(name, operationResult(name, prefix, effect));
			const applied = (loaded: LoadedSession) => ({
				status: "applied" as const,
				confirmed: state.accept(loaded, null),
			});
			const reads = createWorkspaceReads(cataloguePath, () => ({ confirmed, todoContents }));
			const repeatableRead = <A, E>(
				name: string,
				effect: Effect.Effect<A, E, FileSystem | WorkspaceCatalogue>
			) =>
				semaphore
					.withPermit(
						effect.pipe(
							Effect.catchDefect((cause) =>
								Effect.sync(() => {
									diagnostic(name, cause);
									return {
										status: "rejected" as const,
										reason: "unexpected" as const,
										message: "Cannot read Workspace data. An unexpected error occurred. Try again.",
									};
								})
							),
							Effect.withSpan(`WorkspaceSession.${name}`)
						)
					)
					.pipe(Effect.provideContext(dependencies));
			const todos = createTodoOperations(state);
			const views = createSavedViewOperations(
				join(dirname(cataloguePath), "saved-views.json"),
				state
			);
			return WorkspaceSession.of({
				readWorkspaceCatalogue: () => repeatableRead("readWorkspaceCatalogue", reads.catalogue()),
				readWorkspace: (request) => repeatableRead("readWorkspace", reads.workspace(request)),
				setWorkspaceSortOrder: (request) =>
					operation(
						"setWorkspaceSortOrder",
						"Cannot save sort order: ",
						Effect.gen(function* () {
							const current = yield* state.read;
							const loaded = yield* workspace.setSortOrder(request, current, state.todoContents);
							return { status: "applied" as const, confirmed: state.accept(loaded) };
						})
					),
				setWorkspaceShowDeferred: (request) =>
					operation(
						"setWorkspaceShowDeferred",
						"Cannot save Show deferred: ",
						Effect.gen(function* () {
							const current = yield* state.read;
							const loaded = yield* workspace.setShowDeferred(request, current, state.todoContents);
							return { status: "applied" as const, confirmed: state.accept(loaded) };
						})
					),
				stopObservation: semaphore.withPermit(closeObservation),
				readSavedViews: () =>
					semaphore
						.withPermit(
							operationResult("readSavedViews", "", views.read()).pipe(
								Effect.withSpan("WorkspaceSession.readSavedViews")
							)
						)
						.pipe(Effect.provideContext(dependencies)),
				saveView: (request) => operation("saveView", "Cannot save view: ", views.save(request)),
				deleteView: (request) =>
					operation("deleteView", "Cannot delete view: ", views.delete(request)),
				createWorkspace: (request) =>
					operation(
						"createWorkspace",
						"Cannot create Workspace: ",
						workspace.createWorkspace(request).pipe(Effect.map(applied))
					),
				switchWorkspace: (request) =>
					operation(
						"switchWorkspace",
						"",
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
				undoTodo: (request) => operation("undoTodo", "Cannot undo: ", todos.undoTodo(request)),
				editTodo: (request) =>
					operation("editTodo", "Cannot edit Todo item: ", todos.editTodo(request)),
				deleteTodo: (request) =>
					operation("deleteTodo", "Cannot delete Todo item: ", todos.deleteTodo(request)),
				setTodoCompletion: (request) =>
					operation("setTodoCompletion", "", todos.setTodoCompletion(request)),
				bulkDeleteTodos: (request) =>
					operation(
						"bulkDeleteTodos",
						"Cannot delete Todo items: ",
						todos.bulkDeleteTodos(request)
					),
				bulkSetTodoCompletion: (request) =>
					operation("bulkSetTodoCompletion", "", todos.bulkSetTodoCompletion(request)),
				reorderTodo: (request) =>
					operation("reorderTodo", "Cannot reorder Todo items: ", todos.reorderTodo(request)),
			});
		})
	);
}
