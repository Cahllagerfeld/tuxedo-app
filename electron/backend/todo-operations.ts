import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Identity } from "./identity";
import { atomicWrite } from "./atomic-write";
import { setTodoCompletionLine } from "./complete-todo";
import { replaceTodoLines } from "./replace-todo-lines";
import { deleteTodoLine } from "./delete-todo";
import { appendTodoLine, createTodoLine } from "./create-todo";
import { parseTodoFile } from "./todo-file";
import {
	attempt,
	readContents,
	OperationFailure,
	type OperationError,
} from "./workspace-lifecycle";
import type { SessionState } from "./session";
import {
	catalogueSchema,
	createTodoRequestSchema,
	editTodoRequestSchema,
	reorderTodoRequestSchema,
	todoMutationRequestSchema,
	setTodoCompletionRequestSchema,
	type DesktopRequest,
	type DesktopResponse,
	type TodoFile,
	type ConfirmedSession,
} from "../../src/lib/shared/desktop/contract";
type TodoOutcome = DesktopResponse<"createTodo">;

export function createTodoOperations(cataloguePath: string, state: SessionState) {
	const confirmTodo = (
		previous: Extract<ConfirmedSession["session"], { status: "ready" }>,
		workspaceId: string,
		todo_file: TodoFile,
		contents: string
	) => {
		const next = state.accept({ session: { ...previous, todo_file }, todoContents: contents });
		return { scope: next.scope, revision: next.revision, workspaceId, todo_file };
	};
	const todoMutationContext = (
		target: Pick<DesktopRequest<"createTodo">, "scope" | "revision" | "workspaceId">
	) =>
		Effect.gen(function* () {
			const previous = yield* state.read;
			if (
				previous.scope !== target.scope ||
				previous.revision !== target.revision ||
				previous.session.status !== "ready" ||
				previous.session.catalogue.active_workspace_id !== target.workspaceId
			)
				return yield* new OperationFailure({
					message: "The Workspace session changed. Try again with its current Todo file.",
				});
			const contents = yield* readContents(cataloguePath);
			const catalogue = yield* attempt(() => catalogueSchema.parse(JSON.parse(contents)));
			const workspace = catalogue.workspaces.find(
				(workspace) => workspace.id === target.workspaceId
			);
			if (
				catalogue.active_workspace_id !== target.workspaceId ||
				!workspace ||
				workspace.todo_path !== previous.session.todo_file.path
			)
				return yield* new OperationFailure({ message: "The Active workspace changed." });
			return { previous: { ...previous, session: previous.session }, workspace };
		});
	const commitTodo = (
		previous: Extract<ConfirmedSession["session"], { status: "ready" }>,
		workspaceId: string,
		todo_file: TodoFile,
		contents: string
	) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const { mode } = yield* fs.stat(todo_file.path);
			yield* atomicWrite(todo_file.path, contents, mode);
			return {
				status: "applied" as const,
				confirmed: confirmTodo(previous, workspaceId, todo_file, contents),
			};
		}).pipe(Effect.uninterruptible);
	const mutateTodo = (
		request: DesktopRequest<"deleteTodo">,
		transform: (contents: string, item: TodoFile["items"][number]) => string
	): Effect.Effect<TodoOutcome, OperationError, FileSystem | Identity> =>
		Effect.gen(function* () {
			const input = yield* attempt(() => todoMutationRequestSchema.parse(request));
			const { previous, workspace } = yield* todoMutationContext(input);
			const expected = parseTodoFile(workspace.todo_path, input.expectedRaw);
			if (expected.items.length !== 1 || expected.skipped.length || /\n/.test(input.expectedRaw))
				return yield* new OperationFailure({ message: "Invalid Todo item target." });
			const contents = yield* readContents(workspace.todo_path);
			const current = parseTodoFile(workspace.todo_path, contents);
			const item = current.items.find((item) => item.line_number === input.lineNumber);
			if (!item || item.raw !== input.expectedRaw)
				return {
					status: "conflict",
					message: "The Todo item changed on disk. Review its current contents.",
					confirmed: confirmTodo(previous.session, input.workspaceId, current, contents),
				};
			const rewritten = yield* attempt(() => transform(contents, item));
			return yield* commitTodo(
				previous.session,
				input.workspaceId,
				parseTodoFile(workspace.todo_path, rewritten),
				rewritten
			);
		});
	const mutateTodoFile = (
		input: Pick<DesktopRequest<"createTodo">, "scope" | "revision" | "workspaceId">,
		transform: (contents: string, todoFile: TodoFile) => string
	): Effect.Effect<TodoOutcome, OperationError, FileSystem | Identity> =>
		Effect.gen(function* () {
			const { previous, workspace } = yield* todoMutationContext(input);
			const contents = yield* readContents(workspace.todo_path);
			const current = parseTodoFile(workspace.todo_path, contents);
			if (contents !== state.todoContents)
				return {
					status: "conflict",
					message: "The Todo file changed on disk. Review its current contents.",
					confirmed: confirmTodo(previous.session, input.workspaceId, current, contents),
				};
			const rewritten = yield* attempt(() => transform(contents, current));
			if (rewritten === contents)
				return {
					status: "applied",
					confirmed: {
						scope: previous.scope,
						revision: previous.revision,
						workspaceId: input.workspaceId,
						todo_file: current,
					},
				};
			return yield* commitTodo(
				previous.session,
				input.workspaceId,
				parseTodoFile(workspace.todo_path, rewritten),
				rewritten
			);
		});
	return {
		reorderTodo: (request: DesktopRequest<"reorderTodo">) =>
			Effect.gen(function* () {
				const input = yield* attempt(() => reorderTodoRequestSchema.parse(request));
				return yield* mutateTodoFile(input, (contents, todoFile) => {
					const byLine = new Map(todoFile.items.map((item) => [item.line_number, item.raw]));
					if (input.lineNumbers.some((line) => !byLine.has(line)))
						throw Error("Invalid Todo item position.");
					return replaceTodoLines(
						contents,
						[...input.lineNumbers]
							.sort((a, b) => a - b)
							.map((lineNumber, index) => ({
								lineNumber,
								raw: byLine.get(input.lineNumbers[index])!,
							}))
					);
				});
			}),
		createTodo: (request: DesktopRequest<"createTodo">) =>
			Effect.gen(function* () {
				const input = yield* attempt(() => createTodoRequestSchema.parse(request));
				return yield* mutateTodoFile(input, (contents) =>
					appendTodoLine(contents, createTodoLine(input))
				);
			}),
		editTodo: (request: DesktopRequest<"editTodo">) =>
			Effect.gen(function* () {
				const parsed = editTodoRequestSchema.safeParse(request);
				if (!parsed.success)
					return { status: "rejected" as const, message: "Invalid Todo-item edit." };
				const input = parsed.data;
				const { scope, revision, workspaceId, lineNumber, expectedRaw } = input;
				return yield* mutateTodo(
					{ scope, revision, workspaceId, lineNumber, expectedRaw },
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
			}),
		deleteTodo: (request: DesktopRequest<"deleteTodo">) =>
			mutateTodo(request, (contents) => deleteTodoLine(contents, request.lineNumber)),
		setTodoCompletion: (request: DesktopRequest<"setTodoCompletion">) =>
			Effect.gen(function* () {
				const parsed = setTodoCompletionRequestSchema.safeParse(request);
				if (!parsed.success)
					return { status: "rejected" as const, message: "Invalid completion request." };
				const { completed, ...target } = parsed.data;
				const identity = yield* Identity;
				return yield* mutateTodo(target, (contents, item) =>
					replaceTodoLines(contents, [
						{
							lineNumber: item.line_number,
							raw: setTodoCompletionLine(item, completed, new Date(identity.now())),
						},
					])
				);
			}),
	};
}
