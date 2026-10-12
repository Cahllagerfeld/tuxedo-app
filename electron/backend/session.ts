import { readFile, stat } from "node:fs/promises";
import { setTodoCompletionLine } from "./complete-todo";
import { replaceTodoLines } from "./replace-todo-lines";
import { deleteTodoLine } from "./delete-todo";
import { atomicWrite } from "./atomic-write";
import { appendTodoLine, createTodoLine } from "./create-todo";
import { decodeTodoContents, readTodoContents, parseTodoFile } from "./todo-file";
import { Cause, Context, Data, Effect, Layer, ManagedRuntime, Semaphore } from "effect";
import { FileSystem } from "effect/FileSystem";
import { badArgument, type PlatformError } from "effect/PlatformError";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Identity, identityLayer } from "./identity";
import type { TodoFileObservationAdapter } from "./observation";
import {
	catalogueSchema,
	createWorkspaceRequestSchema,
	switchWorkspaceRequestSchema,
	deleteWorkspaceRequestSchema,
	createTodoRequestSchema,
	editTodoRequestSchema,
	reorderTodoRequestSchema,
	todoMutationRequestSchema,
	setTodoCompletionRequestSchema,
	type Catalogue,
	type DesktopRequest,
	type DesktopResponse,
	type TodoFile,
	type ConfirmedSession,
	type DesktopAPI,
	type TodoFileChange,
} from "../../src/lib/shared/desktop/contract";
type SessionBackend = Omit<DesktopAPI, "selectTodoFile">;
type SessionOperation = keyof SessionBackend;
type SessionEffects = {
	[K in SessionOperation]: (request: DesktopRequest<K>) => Effect.Effect<DesktopResponse<K>>;
};
export class WorkspaceSession extends Context.Service<WorkspaceSession, SessionEffects>()(
	"tuxedo/backend/WorkspaceSession"
) {}
class WorkspaceFailure extends Data.TaggedError("WorkspaceFailure")<{ message: string }> {}
type LifecycleFailure = PlatformError | WorkspaceFailure;
const validate = <A>(parse: () => A) =>
	Effect.try({
		try: parse,
		catch: (error) =>
			new WorkspaceFailure({ message: error instanceof Error ? error.message : String(error) }),
	});
export type SessionDependencies = {
	filesystem?: FileSystem;
	identity?: Identity["Service"];
};

function sessionLayer(
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
			const readContents = (path: string) =>
				fs.readFile(path).pipe(
					Effect.flatMap((bytes) =>
						Effect.try({
							try: () => decodeTodoContents(bytes),
							catch: (cause) =>
								badArgument({
									module: "FileSystem",
									method: "readFile",
									description: "Invalid UTF-8 file contents",
									cause,
								}),
						})
					)
				);
			const semaphore = yield* Semaphore.make(1);
			const scope = identity.uuid();
			yield* Effect.addFinalizer(() => Effect.sync(() => observation?.stop()));
			let revision = 0;
			let confirmed: ConfirmedSession | undefined;
			let confirmedTodoContents: string | undefined;
			let busy = false;
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
									const contents = yield* readContents(ready.todo_file.path).pipe(
										Effect.catchTag("PlatformError", () => Effect.succeed(undefined))
									);
									if (contents === confirmedTodoContents) return;
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
			const projectCatalogue = (catalogue: Catalogue) =>
				Effect.gen(function* () {
					const active = catalogue.workspaces.find((w) => w.id === catalogue.active_workspace_id);
					if (!active) return { session: { status: "empty" as const, catalogue, warning: null } };
					return yield* readContents(active.todo_path).pipe(
						Effect.map((todoContents) => ({
							session: {
								status: "ready" as const,
								catalogue,
								todo_file: parseTodoFile(active.todo_path, todoContents),
							},
							todoContents,
						})),
						Effect.catchTag("PlatformError", () =>
							Effect.succeed({
								session: {
									status: "empty" as const,
									catalogue,
									warning: `Cannot open Todo file at ${active.todo_path}. Check its location and permissions.`,
								},
							})
						)
					);
				});
			const load = (): Effect.Effect<{ confirmed: ConfirmedSession; todoContents?: string }> =>
				Effect.gen(function* () {
					const contents = yield* readContents(cataloguePath);
					const catalogue = yield* validate(() => catalogueSchema.parse(JSON.parse(contents)));
					return yield* projectCatalogue(catalogue);
				}).pipe(
					Effect.catchTags({
						PlatformError: (error) =>
							Effect.succeed({
								session:
									error.reason._tag === "NotFound"
										? {
												status: "empty" as const,
												catalogue: {
													version: 1 as const,
													workspaces: [],
													active_workspace_id: null,
												},
												warning: null,
											}
										: unavailableCatalogue(),
							}),
						WorkspaceFailure: () => Effect.succeed({ session: unavailableCatalogue() }),
					}),
					Effect.map((projected) => ({
						confirmed: { scope, revision: revision++, session: projected.session },
						todoContents: "todoContents" in projected ? projected.todoContents : undefined,
					}))
				);
			const unavailableCatalogue = () => ({
				status: "unavailable" as const,
				error: `Cannot read Workspace catalogue at ${cataloguePath}. Check its permissions or restore a valid version-1 backup. The file has been preserved.`,
			});
			const accept = (next: ConfirmedSession, todoContents?: string): ConfirmedSession => {
				confirmed = next;
				confirmedTodoContents = todoContents;
				return next;
			};
			const confirmTodo = (
				previous: Extract<ConfirmedSession["session"], { status: "ready" }>,
				workspaceId: string,
				todo_file: TodoFile,
				contents: string
			) => {
				const next = accept(
					{ scope, revision: revision++, session: { ...previous, todo_file } },
					contents
				);
				return { scope, revision: next.revision, workspaceId, todo_file };
			};
			const commitCatalogue = (
				catalogue: Catalogue,
				todo?: { todo_file: TodoFile; todoContents: string }
			) =>
				Effect.gen(function* () {
					const projected = todo
						? {
								session: { status: "ready" as const, catalogue, todo_file: todo.todo_file },
								todoContents: todo.todoContents,
							}
						: yield* projectCatalogue(catalogue);
					yield* atomicWrite(cataloguePath, JSON.stringify(catalogue, null, 2) + "\n").pipe(
						Effect.provideService(FileSystem, fs),
						Effect.provideService(Identity, identity)
					);
					return {
						status: "applied" as const,
						confirmed: accept(
							{ scope, revision: revision++, session: projected.session },
							"todoContents" in projected ? projected.todoContents : undefined
						),
					};
				});
			const availableCatalogue = () =>
				Effect.gen(function* () {
					const existing = (yield* load()).confirmed;
					if (existing.session.status === "unavailable")
						return yield* Effect.fail(new WorkspaceFailure({ message: existing.session.error }));
					return existing.session.catalogue;
				});
			const lifecycle = <A>(
				operation: string,
				prefix: string,
				effect: Effect.Effect<A, LifecycleFailure>
			) =>
				serialize(
					operation,
					effect.pipe(
						Effect.catchTags({
							PlatformError: (error) =>
								Effect.succeed({ status: "rejected" as const, message: prefix + error.message }),
							WorkspaceFailure: (error) =>
								Effect.succeed({ status: "rejected" as const, message: prefix + error.message }),
						}),
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
					Effect.gen(function* () {
						if (operation === "restoreSession" || !confirmed) {
							const loaded = yield* load();
							accept(loaded.confirmed, loaded.todoContents);
						}
						return confirmed!;
					}).pipe(
						Effect.catchDefect((cause) =>
							diagnostic(operation, cause).pipe(
								Effect.map(
									() =>
										confirmed ??
										accept({
											scope,
											revision: revision++,
											session: {
												status: "unavailable",
												error:
													"Cannot restore the Workspace session. An unexpected error occurred. Try again.",
											},
										})
								)
							)
						)
					)
				);
			// Transitional Todo-item methods run in the same runtime, state, and permit.
			const legacyOperation = <A>(operation: string, run: () => Promise<A>) =>
				serialize(operation, Effect.promise(run));
			const rejected = async <T>(prefix: string, operation: () => Promise<T>) => {
				try {
					return await operation();
				} catch (error) {
					return {
						status: "rejected" as const,
						message: prefix + (error instanceof Error ? error.message : String(error)),
					};
				}
			};
			const todoMutationContext = async (
				target: Pick<DesktopRequest<"createTodo">, "scope" | "revision" | "workspaceId">
			) => {
				if (!confirmed) {
					const loaded = await runEffect(load());
					confirmed = loaded.confirmed;
					confirmedTodoContents = loaded.todoContents;
				}
				const previous = confirmed;
				if (
					previous.scope !== target.scope ||
					previous.revision !== target.revision ||
					previous.session.status !== "ready" ||
					previous.session.catalogue.active_workspace_id !== target.workspaceId
				)
					throw Error("The Workspace session changed. Try again with its current Todo file.");
				const catalogue = catalogueSchema.parse(JSON.parse(await readFile(cataloguePath, "utf8")));
				const workspace = catalogue.workspaces.find(
					(workspace) => workspace.id === target.workspaceId
				);
				if (
					catalogue.active_workspace_id !== target.workspaceId ||
					!workspace ||
					workspace.todo_path !== previous.session.todo_file.path
				)
					throw Error("The Active workspace changed.");
				return { previous: { ...previous, session: previous.session }, workspace };
			};
			const commitTodo = async (
				previous: Extract<ConfirmedSession["session"], { status: "ready" }>,
				workspaceId: string,
				todo_file: TodoFile,
				contents: string
			) => {
				const mode = (await stat(todo_file.path)).mode;
				return await runEffect(
					atomicWrite(todo_file.path, contents, mode).pipe(
						Effect.provideService(FileSystem, fs),
						Effect.provideService(Identity, identity),
						Effect.map(() => ({
							status: "applied" as const,
							confirmed: confirmTodo(previous, workspaceId, todo_file, contents),
						})),
						Effect.uninterruptible
					)
				);
			};
			const mutateTodo = async (
				request: DesktopRequest<"deleteTodo">,
				transform: (contents: string, item: TodoFile["items"][number]) => string
			): Promise<Awaited<ReturnType<DesktopAPI["deleteTodo"]>>> => {
				try {
					const input = todoMutationRequestSchema.parse(request);
					const { previous, workspace } = await todoMutationContext(input);
					const expected = parseTodoFile(workspace.todo_path, input.expectedRaw);
					if (
						expected.items.length !== 1 ||
						expected.skipped.length ||
						/\n/.test(input.expectedRaw)
					)
						throw Error("Invalid Todo item target.");
					const contents = await readTodoContents(workspace.todo_path);
					const current = parseTodoFile(workspace.todo_path, contents);
					const item = current.items.find((item) => item.line_number === input.lineNumber);
					if (!item || item.raw !== input.expectedRaw) {
						return {
							status: "conflict",
							message: "The Todo item changed on disk. Review its current contents.",
							confirmed: confirmTodo(previous.session, input.workspaceId, current, contents),
						};
					}
					const rewritten = transform(contents, item);
					const todo_file = parseTodoFile(workspace.todo_path, rewritten);
					return await commitTodo(previous.session, input.workspaceId, todo_file, rewritten);
				} catch (error) {
					return {
						status: "rejected",
						message: error instanceof Error ? error.message : String(error),
					};
				}
			};

			const mutateTodoFile = async (
				input: Pick<DesktopRequest<"createTodo">, "scope" | "revision" | "workspaceId">,
				transform: (contents: string, todoFile: TodoFile) => string
			): Promise<Awaited<ReturnType<DesktopAPI["reorderTodo"]>>> => {
				const { previous, workspace } = await todoMutationContext(input);
				const contents = await readTodoContents(workspace.todo_path);
				const current = parseTodoFile(workspace.todo_path, contents);
				if (contents !== confirmedTodoContents) {
					return {
						status: "conflict",
						message: "The Todo file changed on disk. Review its current contents.",
						confirmed: confirmTodo(previous.session, input.workspaceId, current, contents),
					};
				}
				const rewritten = transform(contents, current);
				if (rewritten === contents)
					return {
						status: "applied",
						confirmed: {
							scope,
							revision: previous.revision,
							workspaceId: input.workspaceId,
							todo_file: current,
						},
					};
				const todo_file = parseTodoFile(workspace.todo_path, rewritten);
				return await commitTodo(previous.session, input.workspaceId, todo_file, rewritten);
			};
			const todoOperations: Pick<
				SessionEffects,
				"reorderTodo" | "createTodo" | "editTodo" | "deleteTodo" | "setTodoCompletion"
			> = {
				reorderTodo: (request) =>
					legacyOperation("reorderTodo", () =>
						rejected("Cannot reorder Todo items: ", async () => {
							const input = reorderTodoRequestSchema.parse(request);
							return await mutateTodoFile(input, (contents, todoFile) => {
								const byLine = new Map(todoFile.items.map((item) => [item.line_number, item.raw]));
								if (input.lineNumbers.some((line) => !byLine.has(line)))
									throw Error("Invalid Todo item position.");
								const positions = [...input.lineNumbers].sort((a, b) => a - b);
								return replaceTodoLines(
									contents,
									positions.map((lineNumber, index) => ({
										lineNumber,
										raw: byLine.get(input.lineNumbers[index])!,
									}))
								);
							});
						})
					),
				createTodo: (request) =>
					legacyOperation("createTodo", () =>
						rejected("Cannot create Todo item: ", async () => {
							const input = createTodoRequestSchema.parse(request);
							return await mutateTodoFile(input, (contents) =>
								appendTodoLine(contents, createTodoLine(input))
							);
						})
					),
				editTodo: (request) =>
					legacyOperation("editTodo", async () => {
						const parsed = editTodoRequestSchema.safeParse(request);
						if (!parsed.success)
							return { status: "rejected" as const, message: "Invalid Todo-item edit." };
						const input = parsed.data;
						const {
							scope: targetScope,
							revision: targetRevision,
							workspaceId,
							lineNumber,
							expectedRaw,
						} = input;
						const outcome = await mutateTodo(
							{
								scope: targetScope,
								revision: targetRevision,
								workspaceId,
								lineNumber,
								expectedRaw,
							},
							(contents, item) => {
								if (input.completed && item.completion_date && !input.completionDate)
									throw Error("Choose a Completion date for a completed Todo item.");
								const raw =
									input.completed && input.priority
										? [
												"x",
												input.completionDate,
												createTodoLine({ ...input, completed: false, completionDate: null }),
											]
												.filter(Boolean)
												.join(" ")
										: createTodoLine(input);
								return replaceTodoLines(contents, [{ lineNumber: item.line_number, raw }]);
							}
						);
						return outcome.status === "rejected"
							? { ...outcome, message: `Cannot edit Todo item: ${outcome.message}` }
							: outcome;
					}),
				deleteTodo: (request) =>
					legacyOperation("deleteTodo", async () => {
						const outcome = await mutateTodo(request, (contents) =>
							deleteTodoLine(contents, request.lineNumber)
						);
						return outcome.status === "rejected"
							? { ...outcome, message: `Cannot delete Todo item: ${outcome.message}` }
							: outcome;
					}),
				setTodoCompletion: (request) =>
					legacyOperation("setTodoCompletion", async () => {
						const parsed = setTodoCompletionRequestSchema.safeParse(request);
						if (!parsed.success)
							return { status: "rejected" as const, message: "Invalid completion request." };
						const { completed, ...target } = parsed.data;
						return mutateTodo(target, (contents, item) => {
							return replaceTodoLines(contents, [
								{ lineNumber: item.line_number, raw: setTodoCompletionLine(item, completed) },
							]);
						});
					}),
			};
			return WorkspaceSession.of({
				...todoOperations,
				readSession: () => read("readSession"),
				restoreSession: () => read("restoreSession"),
				createWorkspace: (request) =>
					lifecycle(
						"createWorkspace",
						"Cannot create Workspace: ",
						Effect.gen(function* () {
							const input = yield* validate(() => createWorkspaceRequestSchema.parse(request));
							const todoPath = yield* fs.realPath(input.todoPath);
							const todoContents = yield* readContents(todoPath);
							const todo_file = parseTodoFile(todoPath, todoContents);
							if (todo_file.skipped.length)
								return yield* Effect.fail(
									new WorkspaceFailure({
										message: "Cannot create Workspace: Todo file contains skipped lines.",
									})
								);
							const previous = yield* availableCatalogue();
							const workspace = {
								id: identity.uuid(),
								name: input.name,
								color: input.color,
								todo_path: todoPath,
								created_at: identity.now(),
							};
							const catalogue = yield* validate(() =>
								catalogueSchema.parse({
									...previous,
									active_workspace_id: workspace.id,
									workspaces: [...previous.workspaces, workspace],
								})
							);
							return yield* commitCatalogue(catalogue, { todo_file, todoContents });
						})
					),
				switchWorkspace: (request) =>
					lifecycle(
						"switchWorkspace",
						"Cannot open Workspace: ",
						Effect.gen(function* () {
							const { workspaceId } = yield* validate(() =>
								switchWorkspaceRequestSchema.parse(request)
							);
							const previous = yield* availableCatalogue();
							const workspace = previous.workspaces.find((w) => w.id === workspaceId);
							if (!workspace)
								return yield* Effect.fail(
									new WorkspaceFailure({ message: "Workspace does not exist." })
								);
							const todoContents = yield* readContents(workspace.todo_path);
							const todo_file = parseTodoFile(workspace.todo_path, todoContents);
							return yield* commitCatalogue(
								{ ...previous, active_workspace_id: workspaceId },
								{ todo_file, todoContents }
							);
						})
					),
				deleteWorkspace: (request) =>
					lifecycle(
						"deleteWorkspace",
						"Cannot delete Workspace: ",
						Effect.gen(function* () {
							const { workspaceId } = yield* validate(() =>
								deleteWorkspaceRequestSchema.parse(request)
							);
							const previous = yield* availableCatalogue();
							if (!previous.workspaces.some((w) => w.id === workspaceId))
								return yield* Effect.fail(
									new WorkspaceFailure({ message: "Workspace does not exist." })
								);
							const catalogue = yield* validate(() =>
								catalogueSchema.parse({
									...previous,
									workspaces: previous.workspaces.filter((w) => w.id !== workspaceId),
									active_workspace_id:
										previous.active_workspace_id === workspaceId
											? null
											: previous.active_workspace_id,
								})
							);
							return yield* commitCatalogue(catalogue);
						})
					),
			});
		})
	);
}

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
	const layer = sessionLayer(cataloguePath, observation, onTodoFileChanged, (effect) =>
		runtime.runPromise(effect)
	).pipe(Layer.provide(capabilities));
	const runtime: ManagedRuntime.ManagedRuntime<WorkspaceSession, never> =
		ManagedRuntime.make(layer);
	return runtime;
}

export function desktopSessionBackend(
	runtime: ReturnType<typeof createSessionRuntime>
): SessionBackend & { dispose: () => Promise<void> } {
	const run = <K extends SessionOperation>(operation: K, request: DesktopRequest<K>) =>
		runtime.runPromise(
			WorkspaceSession.use((session) => session[operation](request)).pipe(Effect.uninterruptible)
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
