import { readFile, realpath } from "node:fs/promises";
import { deleteTodoLine } from "./delete-todo";
import { atomicWrite } from "./atomic-write";
import { readTodoFile, readTodoContents, parseTodoFile } from "./todo-file";
import { randomUUID } from "node:crypto";
import {
	catalogueSchema,
	createWorkspaceRequestSchema,
	switchWorkspaceRequestSchema,
	deleteWorkspaceRequestSchema,
	todoMutationRequestSchema,
	setTodoCompletionRequestSchema,
	type DesktopRequest,
	type TodoFile,
	type ConfirmedSession,
	type DesktopAPI,
} from "../../src/lib/shared/desktop/contract";
export function createSessionBackend(cataloguePath: string): Omit<DesktopAPI, "selectTodoFile"> {
	const scope = randomUUID();
	let revision = 0;
	let confirmed: ConfirmedSession | undefined;
	let queue: Promise<unknown> = Promise.resolve();
	const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
		const next = queue.then(operation, operation);
		queue = next.catch(() => undefined);
		return next;
	};
	const load = async (): Promise<ConfirmedSession> => {
		let session: ConfirmedSession["session"];
		try {
			const catalogue = catalogueSchema.parse(JSON.parse(await readFile(cataloguePath, "utf8")));
			const active = catalogue.workspaces.find((w) => w.id === catalogue.active_workspace_id);
			if (!active) session = { status: "empty", catalogue, warning: null };
			else {
				try {
					session = { status: "ready", catalogue, todo_file: await readTodoFile(active.todo_path) };
				} catch {
					session = {
						status: "empty",
						catalogue,
						warning: `Cannot open Todo file at ${active.todo_path}. Check its location and permissions.`,
					};
				}
			}
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
		return { scope, revision: revision++, session };
	};
	const mutateTodo = async (
		request: DesktopRequest<"deleteTodo">,
		transform: (contents: string, item: TodoFile["items"][number]) => string
	): Promise<Awaited<ReturnType<DesktopAPI["deleteTodo"]>>> => {
		try {
			const input = todoMutationRequestSchema.parse(request);
			const previous = (confirmed ??= await load());
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
				confirmed = {
					scope,
					revision: revision++,
					session: { ...previous.session, todo_file: current },
				};
				return {
					status: "conflict",
					message: "The Todo item changed on disk. Review its current contents.",
					confirmed: {
						scope,
						revision: confirmed.revision,
						workspaceId: input.workspaceId,
						todo_file: current,
					},
				};
			}
			const rewritten = transform(contents, item);
			const todo_file = parseTodoFile(workspace.todo_path, rewritten);
			await atomicWrite(workspace.todo_path, rewritten);
			confirmed = { scope, revision: revision++, session: { ...previous.session, todo_file } };
			return {
				status: "applied",
				confirmed: {
					scope,
					revision: confirmed.revision,
					workspaceId: input.workspaceId,
					todo_file,
				},
			};
		} catch (error) {
			return {
				status: "rejected",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	};

	return {
		deleteWorkspace: (request) =>
			serialize(async () => {
				try {
					const { workspaceId } = deleteWorkspaceRequestSchema.parse(request);
					const existing = await load();
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
					let session: ConfirmedSession["session"] = { status: "empty", catalogue, warning: null };
					const active = catalogue.workspaces.find((w) => w.id === catalogue.active_workspace_id);
					if (active) {
						try {
							session = {
								status: "ready",
								catalogue,
								todo_file: await readTodoFile(active.todo_path),
							};
						} catch {
							session = {
								status: "empty",
								catalogue,
								warning: `Cannot open Todo file at ${active.todo_path}. Check its location and permissions.`,
							};
						}
					}
					confirmed = { scope, revision: revision++, session };
					return { status: "applied" as const, confirmed };
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
						const marker = /^(\s*)x /.exec(item.raw)!;
						let rest = item.raw.slice(marker[0].length);
						if (item.completion_date) rest = rest.replace(/^\s*\d{4}-\d{2}-\d{2} /, "");
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
					const existing = await load();
					if (existing.session.status === "unavailable") throw Error(existing.session.error);
					const workspace = existing.session.catalogue.workspaces.find((w) => w.id === workspaceId);
					if (!workspace) throw Error("Workspace does not exist.");
					const todo_file = await readTodoFile(workspace.todo_path);
					const catalogue = { ...existing.session.catalogue, active_workspace_id: workspaceId };
					await atomicWrite(cataloguePath, JSON.stringify(catalogue, null, 2) + "\n");
					confirmed = {
						scope,
						revision: revision++,
						session: { status: "ready", catalogue, todo_file },
					};
					return { status: "applied" as const, confirmed };
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
					const todo_file = await readTodoFile(todoPath);
					if (todo_file.skipped.length)
						throw Error("Cannot create Workspace: Todo file contains skipped lines.");
					const existing = await load();
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
					confirmed = {
						scope,
						revision: revision++,
						session: { status: "ready", catalogue, todo_file },
					};
					return { status: "applied" as const, confirmed };
				} catch (error) {
					return {
						status: "rejected" as const,
						message: `Cannot create Workspace: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
			}),
		readSession: () => serialize(async () => (confirmed ??= await load())),
		restoreSession: () => serialize(async () => (confirmed = await load())),
	};
}
