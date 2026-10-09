import { readFile, realpath } from "node:fs/promises";
import { deleteTodoLine } from "./delete-todo";
import { atomicWrite } from "./atomic-write";
import {
	appendTodoLine,
	confirmedTodo,
	createTodoLine,
	type CreateTodoOperation,
} from "./create-todo";
import { readTodoContents, parseTodoFile } from "./todo-file";
import { randomUUID } from "node:crypto";
import {
	catalogueSchema,
	createWorkspaceRequestSchema,
	switchWorkspaceRequestSchema,
	deleteWorkspaceRequestSchema,
	createTodoRequestSchema,
	todoMutationRequestSchema,
	setTodoCompletionRequestSchema,
	type Catalogue,
	type DesktopRequest,
	type TodoFile,
	type ConfirmedSession,
	type DesktopAPI,
} from "../../src/lib/shared/desktop/contract";
type SessionBackend = Omit<DesktopAPI, "selectTodoFile"> & { createTodo: CreateTodoOperation };

export function createSessionBackend(cataloguePath: string): SessionBackend {
	const scope = randomUUID();
	let revision = 0;
	let confirmed: ConfirmedSession | undefined;
	let confirmedTodoContents: string | undefined;
	let queue: Promise<unknown> = Promise.resolve();
	const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
		const next = queue.then(operation, operation);
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
	const mutateTodo = async (
		request: DesktopRequest<"deleteTodo">,
		transform: (contents: string, item: TodoFile["items"][number]) => string
	): Promise<Awaited<ReturnType<DesktopAPI["deleteTodo"]>>> => {
		try {
			const input = todoMutationRequestSchema.parse(request);
			if (!confirmed) {
				const loaded = await load();
				confirmed = loaded.confirmed;
				confirmedTodoContents = loaded.todoContents;
			}
			const previous = confirmed;
			if (
				previous.scope !== input.scope ||
				previous.revision !== input.revision ||
				previous.session.status !== "ready" ||
				previous.session.catalogue.active_workspace_id !== input.workspaceId
			)
				throw Error("The Workspace session changed. Try again with its current Todo file.");
			const catalogue = catalogueSchema.parse(JSON.parse(await readFile(cataloguePath, "utf8")));
			const workspace = catalogue.workspaces.find((w) => w.id === input.workspaceId);
			if (
				catalogue.active_workspace_id !== input.workspaceId ||
				!workspace ||
				workspace.todo_path !== previous.session.todo_file.path
			)
				throw Error("The Active workspace changed.");
			const expected = parseTodoFile(workspace.todo_path, input.expectedRaw);
			if (expected.items.length !== 1 || expected.skipped.length || /\n/.test(input.expectedRaw))
				throw Error("Invalid Todo item target.");
			const contents = await readTodoContents(workspace.todo_path);
			const current = parseTodoFile(workspace.todo_path, contents);
			const item = current.items.find((item) => item.line_number === input.lineNumber);
			if (!item || item.raw !== input.expectedRaw) {
				const next = {
					scope,
					revision: revision++,
					session: { ...previous.session, todo_file: current },
				};
				accept(next, contents);
				return {
					status: "conflict",
					message: "The Todo item changed on disk. Review its current contents.",
					confirmed: confirmedTodo(scope, next.revision, input.workspaceId, current),
				};
			}
			const rewritten = transform(contents, item);
			const todo_file = parseTodoFile(workspace.todo_path, rewritten);
			await atomicWrite(workspace.todo_path, rewritten);
			const next = { scope, revision: revision++, session: { ...previous.session, todo_file } };
			accept(next, rewritten);
			return {
				status: "applied",
				confirmed: confirmedTodo(scope, next.revision, input.workspaceId, todo_file),
			};
		} catch (error) {
			return {
				status: "rejected",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	};

	return {
		createTodo: (request) =>
			serialize(async () => {
				try {
					const input = createTodoRequestSchema.parse(request);
					if (!confirmed) {
						const loaded = await load();
						confirmed = loaded.confirmed;
						confirmedTodoContents = loaded.todoContents;
					}
					const previous = confirmed;
					if (
						previous.scope !== input.scope ||
						previous.revision !== input.revision ||
						previous.session.status !== "ready" ||
						previous.session.catalogue.active_workspace_id !== input.workspaceId
					)
						throw Error("The Workspace session changed. Try again with its current Todo file.");
					const catalogue = catalogueSchema.parse(
						JSON.parse(await readFile(cataloguePath, "utf8"))
					);
					const workspace = catalogue.workspaces.find(
						(workspace) => workspace.id === input.workspaceId
					);
					if (
						catalogue.active_workspace_id !== input.workspaceId ||
						!workspace ||
						workspace.todo_path !== previous.session.todo_file.path
					)
						throw Error("The Active workspace changed.");
					const contents = await readTodoContents(workspace.todo_path);
					if (contents !== confirmedTodoContents) {
						const todo_file = parseTodoFile(workspace.todo_path, contents);
						const next = {
							scope,
							revision: revision++,
							session: { ...previous.session, todo_file },
						};
						accept(next, contents);
						return {
							status: "conflict" as const,
							message: "The Todo file changed on disk. Review its current contents.",
							confirmed: confirmedTodo(scope, next.revision, input.workspaceId, todo_file),
						};
					}
					const rewritten = appendTodoLine(contents, createTodoLine(input));
					const todo_file = parseTodoFile(workspace.todo_path, rewritten);
					await atomicWrite(workspace.todo_path, rewritten);
					const next = { scope, revision: revision++, session: { ...previous.session, todo_file } };
					accept(next, rewritten);
					return {
						status: "applied" as const,
						confirmed: confirmedTodo(scope, next.revision, input.workspaceId, todo_file),
					};
				} catch (error) {
					return {
						status: "rejected" as const,
						message: `Cannot create Todo item: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
			}),
		deleteWorkspace: (request) =>
			serialize(async () => {
				try {
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
					await atomicWrite(cataloguePath, JSON.stringify(catalogue, null, 2) + "\n");
					const projected = await projectCatalogue(catalogue);
					const next = { scope, revision: revision++, session: projected.session };
					accept(next, projected.todoContents);
					return { status: "applied" as const, confirmed: next };
				} catch (error) {
					return {
						status: "rejected" as const,
						message: `Cannot delete Workspace: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
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
					let raw: string;
					if (completed) {
						const date = new Date();
						const today = `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
						raw = `x ${today} ${item.raw}`;
					} else {
						const marker = /^(\p{White_Space}*)x /u.exec(item.raw)!;
						let rest = item.raw.slice(marker[0].length);
						if (item.completion_date) rest = rest.slice(11);
						raw = marker[1] + rest;
					}
					lines[item.line_number - 1] = raw + ending;
					return lines.join("");
				});
			}),
		switchWorkspace: (request) =>
			serialize(async () => {
				try {
					const { workspaceId } = switchWorkspaceRequestSchema.parse(request);
					const existing = (await load()).confirmed;
					if (existing.session.status === "unavailable") throw Error(existing.session.error);
					const workspace = existing.session.catalogue.workspaces.find((w) => w.id === workspaceId);
					if (!workspace) throw Error("Workspace does not exist.");
					const todoContents = await readTodoContents(workspace.todo_path);
					const todo_file = parseTodoFile(workspace.todo_path, todoContents);
					const catalogue = { ...existing.session.catalogue, active_workspace_id: workspaceId };
					await atomicWrite(cataloguePath, JSON.stringify(catalogue, null, 2) + "\n");
					const next: ConfirmedSession = {
						scope,
						revision: revision++,
						session: { status: "ready", catalogue, todo_file },
					};
					accept(next, todoContents);
					return { status: "applied" as const, confirmed: next };
				} catch (error) {
					return {
						status: "rejected" as const,
						message: `Cannot open Workspace: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
			}),
		createWorkspace: (request) =>
			serialize(async () => {
				try {
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
					await atomicWrite(cataloguePath, JSON.stringify(catalogue, null, 2) + "\n");
					const next: ConfirmedSession = {
						scope,
						revision: revision++,
						session: { status: "ready", catalogue, todo_file },
					};
					accept(next, todoContents);
					return { status: "applied" as const, confirmed: next };
				} catch (error) {
					return {
						status: "rejected" as const,
						message: `Cannot create Workspace: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
			}),
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
