import { readFile, realpath } from "node:fs/promises";
import { deleteTodoLine } from "./delete-todo";
import { atomicWrite } from "./atomic-write";
import { appendTodoLine, createTodoLine } from "./create-todo";
import { readTodoContents, parseTodoFile } from "./todo-file";
import { randomUUID } from "node:crypto";
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
	type TodoFile,
	type ConfirmedSession,
	type DesktopAPI,
	type TodoFileChange,
} from "../../src/lib/shared/desktop/contract";
type SessionBackend = Omit<DesktopAPI, "selectTodoFile">;

export function createSessionBackend(
	cataloguePath: string,
	observation?: TodoFileObservationAdapter,
	onTodoFileChanged: (event: TodoFileChange) => void = () => {}
): SessionBackend {
	const scope = randomUUID();
	let revision = 0;
	let confirmed: ConfirmedSession | undefined;
	let confirmedTodoContents: string | undefined;
	let queue: Promise<unknown> = Promise.resolve();
	let busy = false;
	const syncObservation = () => {
		const current = confirmed;
		const ready = current?.session.status === "ready" ? current.session : null;
		observation?.retarget(ready?.todo_file.path ?? null, () => {
			if (busy || !current || !ready || current !== confirmed) return;
			void serialize(async () => {
				if (current !== confirmed) return;
				try {
					// Delayed watch events from own writes must not interrupt a renderer drag.
					if ((await readTodoContents(ready.todo_file.path)) === confirmedTodoContents) return;
				} catch {
					// An unreadable file still needs restoration into Empty.
				}
				onTodoFileChanged({
					scope: current.scope,
					revision: current.revision,
					workspaceId: ready.catalogue.active_workspace_id!,
					todoPath: ready.todo_file.path,
				});
			});
		});
	};
	const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
		const run = async () => {
			busy = true;
			try {
				return await operation();
			} finally {
				busy = false;
				syncObservation();
			}
		};
		const next = queue.then(run, run);
		queue = next.catch(() => undefined);
		return next;
	};
	const projectCatalogue = async (
		catalogue: Catalogue
	): Promise<{ session: ConfirmedSession["session"]; todoContents?: string }> => {
		const active = catalogue.workspaces.find((w) => w.id === catalogue.active_workspace_id);
		if (!active) return { session: { status: "empty", catalogue, warning: null } };
		try {
			const todoContents = await readTodoContents(active.todo_path);
			return {
				session: {
					status: "ready",
					catalogue,
					todo_file: parseTodoFile(active.todo_path, todoContents),
				},
				todoContents,
			};
		} catch {
			return {
				session: {
					status: "empty",
					catalogue,
					warning: `Cannot open Todo file at ${active.todo_path}. Check its location and permissions.`,
				},
			};
		}
	};
	const load = async (): Promise<{ confirmed: ConfirmedSession; todoContents?: string }> => {
		let session: ConfirmedSession["session"];
		let todoContents: string | undefined;
		try {
			const catalogue = catalogueSchema.parse(JSON.parse(await readFile(cataloguePath, "utf8")));
			const projected = await projectCatalogue(catalogue);
			session = projected.session;
			todoContents = projected.todoContents;
		} catch (error) {
			if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
				session = {
					status: "empty",
					catalogue: { version: 1, workspaces: [], active_workspace_id: null },
					warning: null,
				};
			else
				session = {
					status: "unavailable",
					error: `Cannot read Workspace catalogue at ${cataloguePath}. Check its permissions or restore a valid version-1 backup. The file has been preserved.`,
				};
		}
		return { confirmed: { scope, revision: revision++, session }, todoContents };
	};
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
	const commitCatalogue = async (
		catalogue: Catalogue,
		todo?: { todo_file: TodoFile; todoContents: string }
	) => {
		await atomicWrite(cataloguePath, JSON.stringify(catalogue, null, 2) + "\n");
		const projected = todo
			? {
					session: { status: "ready" as const, catalogue, todo_file: todo.todo_file },
					todoContents: todo.todoContents,
				}
			: await projectCatalogue(catalogue);
		return {
			status: "applied" as const,
			confirmed: accept(
				{ scope, revision: revision++, session: projected.session },
				projected.todoContents
			),
		};
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
		if (!confirmed) {
			const loaded = await load();
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
		const workspace = catalogue.workspaces.find((workspace) => workspace.id === target.workspaceId);
		if (
			catalogue.active_workspace_id !== target.workspaceId ||
			!workspace ||
			workspace.todo_path !== previous.session.todo_file.path
		)
			throw Error("The Active workspace changed.");
		return { previous: { ...previous, session: previous.session }, workspace };
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
			await atomicWrite(workspace.todo_path, rewritten);
			return {
				status: "applied",
				confirmed: confirmTodo(previous.session, input.workspaceId, todo_file, rewritten),
			};
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
		await atomicWrite(workspace.todo_path, rewritten);
		return {
			status: "applied",
			confirmed: confirmTodo(previous.session, input.workspaceId, todo_file, rewritten),
		};
	};

	return {
		reorderTodo: (request) =>
			serialize(() =>
				rejected("Cannot reorder Todo items: ", async () => {
					const input = reorderTodoRequestSchema.parse(request);
					return await mutateTodoFile(input, (contents, todoFile) => {
						const byLine = new Map(todoFile.items.map((item) => [item.line_number, item.raw]));
						if (input.lineNumbers.some((line) => !byLine.has(line)))
							throw Error("Invalid Todo item position.");
						const lines = contents.match(/[^\n]*\n|[^\n]+$/g) ?? [];
						const positions = [...input.lineNumbers].sort((a, b) => a - b);
						positions.forEach((position, index) => {
							const line = lines[position - 1];
							const ending = line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "";
							lines[position - 1] = byLine.get(input.lineNumbers[index])! + ending;
						});
						return lines.join("");
					});
				})
			),
		createTodo: (request) =>
			serialize(() =>
				rejected("Cannot create Todo item: ", async () => {
					const input = createTodoRequestSchema.parse(request);
					return await mutateTodoFile(input, (contents) =>
						appendTodoLine(contents, createTodoLine(input))
					);
				})
			),
		deleteWorkspace: (request) =>
			serialize(() =>
				rejected("Cannot delete Workspace: ", async () => {
					const { workspaceId } = deleteWorkspaceRequestSchema.parse(request);
					const existing = (await load()).confirmed;
					if (existing.session.status === "unavailable") throw Error(existing.session.error);
					const previous = existing.session.catalogue;
					if (!previous.workspaces.some((w) => w.id === workspaceId))
						throw Error("Workspace does not exist.");
					const catalogue = catalogueSchema.parse({
						...previous,
						workspaces: previous.workspaces.filter((w) => w.id !== workspaceId),
						active_workspace_id:
							previous.active_workspace_id === workspaceId ? null : previous.active_workspace_id,
					});
					return await commitCatalogue(catalogue);
				})
			),
		editTodo: (request) =>
			serialize(async () => {
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
					{ scope: targetScope, revision: targetRevision, workspaceId, lineNumber, expectedRaw },
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
						const lines = contents.match(/[^\n]*\n|[^\n]+$/g) ?? [];
						const line = lines[item.line_number - 1];
						const ending = line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "";
						lines[item.line_number - 1] = raw + ending;
						return lines.join("");
					}
				);
				return outcome.status === "rejected"
					? { ...outcome, message: `Cannot edit Todo item: ${outcome.message}` }
					: outcome;
			}),
		deleteTodo: (request) =>
			serialize(async () => {
				const outcome = await mutateTodo(request, (contents) =>
					deleteTodoLine(contents, request.lineNumber)
				);
				return outcome.status === "rejected"
					? { ...outcome, message: `Cannot delete Todo item: ${outcome.message}` }
					: outcome;
			}),
		setTodoCompletion: (request) =>
			serialize(async () => {
				const parsed = setTodoCompletionRequestSchema.safeParse(request);
				if (!parsed.success)
					return { status: "rejected" as const, message: "Invalid completion request." };
				const { completed, ...target } = parsed.data;
				return mutateTodo(target, (contents, item) => {
					if (item.completed === completed)
						throw Error("Todo item already has the requested completion state.");
					const lines = contents.match(/[^\n]*\n|[^\n]+$/g) ?? [];
					const line = lines[item.line_number - 1];
					const ending = line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "";
					const priorities = [
						...item.raw.matchAll(
							/(?:^|\p{White_Space})pri:([^:\p{White_Space}]+)(?=\p{White_Space}|$)/gu
						),
					].map((match) => match[1]);
					let raw: string;
					if (completed) {
						const date = new Date();
						const today = `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
						let rest = item.raw;
						if (item.priority) {
							if (priorities.some((priority) => priority !== item.priority))
								throw Error(
									"Conflicting priority metadata; edit the Todo file before completing this item."
								);
							rest = rest.slice(4);
							if (!priorities.length) {
								const trailing = /\p{White_Space}*$/u.exec(rest)![0];
								rest = `${rest.slice(0, rest.length - trailing.length)} pri:${item.priority}${trailing}`;
							}
						}
						raw = `x ${today} ${rest}`;
					} else {
						let rest = item.raw.slice(2);
						if (item.completion_date) rest = rest.slice(11);
						if (!item.priority && /^[A-Z]$/.test(item.metadata.pri ?? "")) {
							if (priorities.some((priority) => priority !== item.metadata.pri))
								throw Error(
									"Conflicting priority metadata; edit the Todo file before uncompleting this item."
								);
							rest = rest.replace(/(^|\p{White_Space})pri:[A-Z](?=\p{White_Space}|$)/gu, "");
							rest = `(${item.metadata.pri}) ${rest.replace(/^\p{White_Space}+/u, "")}`;
						}
						if (/^\p{White_Space}*$/u.test(rest))
							throw Error(
								"Cannot uncomplete a Todo item without remaining content. Edit the Todo file first."
							);
						raw = rest;
					}
					lines[item.line_number - 1] = raw + ending;
					return lines.join("");
				});
			}),
		switchWorkspace: (request) =>
			serialize(() =>
				rejected("Cannot open Workspace: ", async () => {
					const { workspaceId } = switchWorkspaceRequestSchema.parse(request);
					const existing = (await load()).confirmed;
					if (existing.session.status === "unavailable") throw Error(existing.session.error);
					const workspace = existing.session.catalogue.workspaces.find((w) => w.id === workspaceId);
					if (!workspace) throw Error("Workspace does not exist.");
					const todoContents = await readTodoContents(workspace.todo_path);
					const todo_file = parseTodoFile(workspace.todo_path, todoContents);
					const catalogue = { ...existing.session.catalogue, active_workspace_id: workspaceId };
					return await commitCatalogue(catalogue, { todo_file, todoContents });
				})
			),
		createWorkspace: (request) =>
			serialize(() =>
				rejected("Cannot create Workspace: ", async () => {
					const input = createWorkspaceRequestSchema.parse(request);
					const todoPath = await realpath(input.todoPath);
					const todoContents = await readTodoContents(todoPath);
					const todo_file = parseTodoFile(todoPath, todoContents);
					if (todo_file.skipped.length)
						throw Error("Cannot create Workspace: Todo file contains skipped lines.");
					const existing = (await load()).confirmed;
					if (existing.session.status === "unavailable") throw Error(existing.session.error);
					const workspace = {
						id: randomUUID(),
						name: input.name,
						color: input.color,
						todo_path: todoPath,
						created_at: new Date().toISOString(),
					};
					const catalogue = catalogueSchema.parse({
						...existing.session.catalogue,
						active_workspace_id: workspace.id,
						workspaces: [...existing.session.catalogue.workspaces, workspace],
					});
					return await commitCatalogue(catalogue, { todo_file, todoContents });
				})
			),
		readSession: () =>
			serialize(async () => {
				if (!confirmed) {
					const loaded = await load();
					accept(loaded.confirmed, loaded.todoContents);
				}
				return confirmed!;
			}),
		restoreSession: () =>
			serialize(async () => {
				const loaded = await load();
				return accept(loaded.confirmed, loaded.todoContents);
			}),
	};
}
