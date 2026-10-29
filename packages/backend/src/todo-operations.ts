import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Identity } from "./identity";
import { WorkspaceCatalogue } from "./workspace-catalogue";
import { atomicWrite } from "./atomic-write";
import { setTodoCompletionLine } from "./complete-todo";
import { recurringCompletion, generationMarker } from "./recurrence";
import { replaceTodoLines } from "./replace-todo-lines";
import { deleteTodoLine, deleteTodoLines } from "./delete-todo";
import { appendTodoLine, createTodoLine } from "./create-todo";
import { parseTodoFile } from "./todo-file";
import { attempt, readContents, OperationFailure, type OperationError } from "./operation";
import type { SessionState, UndoChange } from "./session";
import { bulkCompleteTodos } from "./bulk-complete-todos";
import {
	createTodoRequestSchema,
	editTodoRequestSchema,
	reorderTodoRequestSchema,
	moveTodoOnBoardRequestSchema,
	todoMutationRequestSchema,
	setTodoCompletionRequestSchema,
	bulkSetTodoCompletionRequestSchema,
	bulkDeleteTodosRequestSchema,
	undoTodoRequestSchema,
	type UndoLabel,
	type DesktopRequest,
	type DesktopResponse,
	type TodoFile,
	type ConfirmedSession,
} from "@tuxedo/contracts";

export function createTodoOperations(state: SessionState) {
	const confirmTodo = (
		previous: Extract<ConfirmedSession["session"], { status: "ready" }>,
		workspaceId: string,
		todo_file: TodoFile,
		contents: string,
		undo?: UndoChange | null
	) => {
		const next = state.accept(
			{ session: { ...previous, todo_file }, todoContents: contents },
			undo
		);
		return {
			scope: next.scope,
			revision: next.revision,
			workspaceId,
			todo_file,
			...(next.undoLabel ? { undoLabel: next.undoLabel } : {}),
		};
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
			const store = yield* WorkspaceCatalogue;
			const catalogue = yield* store.read;
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
		path: string,
		contents: string,
		undo: UndoChange | null
	) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const todo_file = parseTodoFile(path, contents);
			const { mode } = yield* fs.stat(path);
			yield* atomicWrite(path, contents, mode);
			return {
				status: "applied" as const,
				confirmed: confirmTodo(previous, workspaceId, todo_file, contents, undo),
			};
		}).pipe(Effect.uninterruptible);
	const mutateTodo = (
		request: DesktopRequest<"deleteTodo">,
		label: UndoLabel,
		transform: (
			contents: string,
			item: TodoFile["items"][number]
		) => string | { contents: string; notice?: string }
	): Effect.Effect<
		DesktopResponse<"createTodo">,
		OperationError,
		FileSystem | Identity | WorkspaceCatalogue
	> =>
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
			const transformed = yield* attempt(() => transform(contents, item));
			const rewritten = typeof transformed === "string" ? transformed : transformed.contents;
			const notice = typeof transformed === "string" ? undefined : transformed.notice;
			if (rewritten === contents)
				return {
					status: "applied",
					confirmed: confirmTodo(previous.session, input.workspaceId, current, contents),
				};
			const result = yield* commitTodo(
				previous.session,
				input.workspaceId,
				workspace.todo_path,
				rewritten,
				{ contents, label }
			);
			return { ...result, ...(notice ? { notice } : {}) };
		});
	const mutateTodoFile = (
		input:
			| Pick<DesktopRequest<"createTodo">, "scope" | "revision" | "workspaceId">
			| DesktopRequest<"bulkSetTodoCompletion">
			| DesktopRequest<"bulkDeleteTodos">,
		label: UndoLabel,
		transform: (
			contents: string,
			todoFile: TodoFile
		) => string | { contents: string; notice?: string }
	): Effect.Effect<
		DesktopResponse<"createTodo">,
		OperationError,
		FileSystem | Identity | WorkspaceCatalogue
	> =>
		Effect.gen(function* () {
			const { previous, workspace } = yield* todoMutationContext(input);
			const contents = yield* readContents(workspace.todo_path);
			const current = parseTodoFile(workspace.todo_path, contents);
			const conflicts =
				"targets" in input
					? input.targets.some(
							(target) =>
								current.items.find((item) => item.line_number === target.lineNumber)?.raw !==
								target.expectedRaw
						)
					: contents !== state.todoContents;
			if (conflicts)
				return {
					status: "conflict",
					message: "The Todo file changed on disk. Review its current contents.",
					confirmed: confirmTodo(previous.session, input.workspaceId, current, contents),
				};
			const transformed = yield* attempt(() => transform(contents, current));
			const rewritten = typeof transformed === "string" ? transformed : transformed.contents;
			const notice = typeof transformed === "string" ? undefined : transformed.notice;
			if (rewritten === contents)
				return {
					status: "applied",
					confirmed: {
						scope: previous.scope,
						revision: previous.revision,
						workspaceId: input.workspaceId,
						...(previous.undoLabel ? { undoLabel: previous.undoLabel } : {}),
						todo_file: current,
					},
					...(notice ? { notice } : {}),
				};
			const result = yield* commitTodo(
				previous.session,
				input.workspaceId,
				workspace.todo_path,
				rewritten,
				{ contents, label }
			);
			return { ...result, ...(notice ? { notice } : {}) };
		});
	return {
		moveTodoOnBoard: (request: DesktopRequest<"moveTodoOnBoard">) =>
			Effect.gen(function* () {
				const parsed = moveTodoOnBoardRequestSchema.safeParse(request);
				if (!parsed.success) return { status: "rejected" as const, message: "Invalid board move." };
				const { column, ...target } = parsed.data;
				return yield* mutateTodo(target, "Undo move", (contents, item) => {
					if (item.completed)
						throw Error("Only open Todo items can be moved between open columns.");
					let replaced = false;
					let raw = item.raw.replace(
						/(^|\p{White_Space})board:[^\p{White_Space}]*/gu,
						(_token, whitespace: string) => {
							if (replaced) return whitespace;
							replaced = true;
							return `${whitespace}board:${column}`;
						}
					);
					if (!replaced)
						raw = raw.replace(
							/(\p{White_Space}*)$/u,
							(_suffix, whitespace: string) => ` board:${column}${whitespace}`
						);
					return replaceTodoLines(contents, [{ lineNumber: item.line_number, raw }]);
				});
			}),
		undoTodo: (request: DesktopRequest<"undoTodo">) =>
			Effect.gen(function* () {
				const input = yield* attempt(() => undoTodoRequestSchema.parse(request));
				const { previous, workspace } = yield* todoMutationContext(input);
				const undo = state.undo;
				if (!undo) return { status: "rejected" as const, message: "There is no change to undo." };
				const contents = yield* readContents(workspace.todo_path);
				if (contents !== state.todoContents)
					return {
						status: "conflict" as const,
						message: "The Todo file changed on disk. Undo is no longer available.",
						confirmed: confirmTodo(
							previous.session,
							input.workspaceId,
							parseTodoFile(workspace.todo_path, contents),
							contents,
							null
						),
					};
				return yield* commitTodo(
					previous.session,
					input.workspaceId,
					workspace.todo_path,
					undo.contents,
					null
				);
			}),
		reorderTodo: (request: DesktopRequest<"reorderTodo">) =>
			Effect.gen(function* () {
				const input = yield* attempt(() => reorderTodoRequestSchema.parse(request));
				return yield* mutateTodoFile(input, "Undo reordering", (contents, todoFile) => {
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
				const identity = yield* Identity;
				return yield* mutateTodoFile(input, "Undo creation", (contents) =>
					appendTodoLine(contents, createTodoLine(input, new Date(identity.now())))
				);
			}),
		editTodo: (request: DesktopRequest<"editTodo">) =>
			Effect.gen(function* () {
				const parsed = editTodoRequestSchema.safeParse(request);
				if (!parsed.success)
					return { status: "rejected" as const, message: "Invalid Todo-item edit." };
				const input = parsed.data;
				const { scope, revision, workspaceId, lineNumber, expectedRaw } = input;
				const identity = yield* Identity;
				const today = new Date(identity.now());
				return yield* mutateTodo(
					{ scope, revision, workspaceId, lineNumber, expectedRaw },
					"Undo edit",
					(contents, item) => {
						if (input.completed && item.completion_date && !input.completionDate)
							throw Error("Choose a Completion date for a completed Todo item.");
						const metadata = (input.metadata ?? []).filter(
							(token) => !token.startsWith(`${generationMarker}:`)
						);
						if (Object.hasOwn(item.metadata, generationMarker))
							metadata.push(
								...item.edit.metadata.filter((token) => token.startsWith(`${generationMarker}:`))
							);
						const saved = { ...input, metadata };
						const raw =
							input.completed && input.priority
								? [
										"x",
										input.completionDate,
										createTodoLine({ ...saved, completed: false, completionDate: null }, today),
									]
										.filter(Boolean)
										.join(" ")
								: createTodoLine(saved, today);
						return input.completed && !item.completed
							? recurringCompletion(contents, item, raw, today, input.priority ?? null)
							: replaceTodoLines(contents, [{ lineNumber: item.line_number, raw }]);
					}
				);
			}),
		deleteTodo: (request: DesktopRequest<"deleteTodo">) =>
			mutateTodo(request, "Undo deletion", (contents) =>
				deleteTodoLine(contents, request.lineNumber)
			),
		setTodoCompletion: (request: DesktopRequest<"setTodoCompletion">) =>
			Effect.gen(function* () {
				const parsed = setTodoCompletionRequestSchema.safeParse(request);
				if (!parsed.success)
					return { status: "rejected" as const, message: "Invalid completion request." };
				const { completed, ...target } = parsed.data;
				const identity = yield* Identity;
				return yield* mutateTodo(
					target,
					completed ? "Undo completion" : "Undo uncompletion",
					(contents, item) => {
						const today = new Date(identity.now());
						const raw = setTodoCompletionLine(item, completed, today);
						return completed
							? recurringCompletion(contents, item, raw, today)
							: replaceTodoLines(contents, [{ lineNumber: item.line_number, raw }]);
					}
				);
			}),
		bulkDeleteTodos: (request: DesktopRequest<"bulkDeleteTodos">) =>
			Effect.gen(function* () {
				const parsed = bulkDeleteTodosRequestSchema.safeParse(request);
				if (!parsed.success)
					return { status: "rejected" as const, message: "Invalid bulk deletion request." };
				const input = parsed.data;
				if (
					input.targets.some((target) => {
						const expected = parseTodoFile("", target.expectedRaw);
						return expected.items.length !== 1 || expected.skipped.length !== 0;
					})
				)
					return { status: "rejected" as const, message: "Invalid Todo item target." };
				return yield* mutateTodoFile(input, "Undo deletion", (contents) =>
					deleteTodoLines(
						contents,
						input.targets.map((target) => target.lineNumber)
					)
				);
			}),
		bulkSetTodoCompletion: (request: DesktopRequest<"bulkSetTodoCompletion">) =>
			Effect.gen(function* () {
				const parsed = bulkSetTodoCompletionRequestSchema.safeParse(request);
				if (!parsed.success)
					return { status: "rejected" as const, message: "Invalid bulk completion request." };
				const input = parsed.data;
				const identity = yield* Identity;
				const today = new Date(identity.now());
				return yield* mutateTodoFile(
					input,
					input.completed ? "Undo completion" : "Undo uncompletion",
					(contents, current) =>
						bulkCompleteTodos(contents, current, input.targets, input.completed, today)
				);
			}),
	};
}
