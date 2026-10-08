import { readFile, realpath } from "node:fs/promises";
import { atomicWrite } from "./atomic-write";
import { readTodoFile } from "./todo-file";
import { randomUUID } from "node:crypto";
import {
	catalogueSchema,
	createWorkspaceRequestSchema,
	deleteWorkspaceRequestSchema,
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
