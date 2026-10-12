import { readFile, stat } from "node:fs/promises";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Identity } from "./identity";
import { atomicWrite } from "./atomic-write";
import { setTodoCompletionLine } from "./complete-todo";
import { replaceTodoLines } from "./replace-todo-lines";
import { deleteTodoLine } from "./delete-todo";
import { appendTodoLine, createTodoLine } from "./create-todo";
import { readTodoContents, parseTodoFile } from "./todo-file";
import type { SessionState } from "./session";
import {
	catalogueSchema,
	createTodoRequestSchema,
	editTodoRequestSchema,
	reorderTodoRequestSchema,
	todoMutationRequestSchema,
	setTodoCompletionRequestSchema,
	type DesktopAPI,
	type DesktopRequest,
	type TodoFile,
	type ConfirmedSession,
} from "../../src/lib/shared/desktop/contract";
export type TodoOperation =
	"createTodo" | "editTodo" | "reorderTodo" | "deleteTodo" | "setTodoCompletion";

export function createTodoOperations(
	cataloguePath: string,
	fs: FileSystem,
	identity: Identity["Service"],
	state: SessionState,
	runEffect: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>
): Pick<DesktopAPI, TodoOperation> {
	const confirmTodo = (
		previous: Extract<ConfirmedSession["session"], { status: "ready" }>,
		workspaceId: string,
		todo_file: TodoFile,
		contents: string
	) => {
		const next = state.accept({ session: { ...previous, todo_file }, todoContents: contents });
		return { scope: next.scope, revision: next.revision, workspaceId, todo_file };
	};
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
		const previous = state.confirmed ?? (await runEffect(state.read));
		if (
			previous.scope !== target.scope ||
			previous.revision !== target.revision ||
			previous.session.status !== "ready" ||
			previous.session.catalogue.active_workspace_id !== target.workspaceId
		)
			throw Error("The Workspace session changed. Try again with its current Todo file.");
		const catalogue = catalogueSchema.parse(JSON.parse(await readFile(cataloguePath, "utf8")));
		const workspace = catalogue.workspaces.find((workspace) => workspace.id === target.workspaceId);
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
			if (expected.items.length !== 1 || expected.skipped.length || /\n/.test(input.expectedRaw))
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
		if (contents !== state.todoContents) {
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
					scope: previous.scope,
					revision: previous.revision,
					workspaceId: input.workspaceId,
					todo_file: current,
				},
			};
		const todo_file = parseTodoFile(workspace.todo_path, rewritten);
		return await commitTodo(previous.session, input.workspaceId, todo_file, rewritten);
	};
	return {
		reorderTodo: (request) =>
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
			}),
		createTodo: (request) =>
			rejected("Cannot create Todo item: ", async () => {
				const input = createTodoRequestSchema.parse(request);
				return await mutateTodoFile(input, (contents) =>
					appendTodoLine(contents, createTodoLine(input))
				);
			}),
		editTodo: async (request) => {
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
		},
		deleteTodo: async (request) => {
			const outcome = await mutateTodo(request, (contents) =>
				deleteTodoLine(contents, request.lineNumber)
			);
			return outcome.status === "rejected"
				? { ...outcome, message: `Cannot delete Todo item: ${outcome.message}` }
				: outcome;
		},
		setTodoCompletion: async (request) => {
			const parsed = setTodoCompletionRequestSchema.safeParse(request);
			if (!parsed.success)
				return { status: "rejected" as const, message: "Invalid completion request." };
			const { completed, ...target } = parsed.data;
			return mutateTodo(target, (contents, item) => {
				return replaceTodoLines(contents, [
					{ lineNumber: item.line_number, raw: setTodoCompletionLine(item, completed) },
				]);
			});
		},
	};
}
