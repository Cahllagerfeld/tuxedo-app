import { expect, test } from "vitest";
import { createDesktopClient, type WorkspaceRead } from "@tuxedo/contracts";
import type { WorkspaceData } from "./workspace-route-data";
import { WorkspaceCommands } from "./workspace-commands.svelte";

const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const workspace = {
	id: workspaceId,
	name: "Personal",
	color: "blue" as const,
	todo_path: "/tmp/todo.txt",
	created_at: "2026-07-10T10:00:00Z",
};
const item = {
	line_number: 1,
	raw: "Call Mom",
	completed: false,
	priority: null,
	creation_date: null,
	completion_date: null,
	description: "Call Mom",
	projects: [],
	contexts: [],
	metadata: {},
	edit: { description: "Call Mom", metadata: [] },
};
const selection = (revision: number) => ({
	scope,
	revision,
	workspaceId,
	todoPath: workspace.todo_path,
});
const contents = (revision: number): Extract<WorkspaceRead, { status: "ready" }> => ({
	status: "ready",
	workspace,
	todo_file: {
		path: workspace.todo_path,
		items: [{ ...item, completed: revision > 5 }],
		skipped: [],
	},
	provenance: { status: "confirmed", selection: selection(revision) },
});

test("completion holds admission and visible contents through route publication", async () => {
	let current: WorkspaceData = { workspaceId, value: contents(5), error: "" };
	let entered!: () => void;
	const refreshing = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let publish!: () => void;
	const released = new Promise<void>((resolve) => {
		publish = resolve;
	});
	const requests: unknown[] = [];
	const desktop = createDesktopClient(async (channel, request) => {
		requests.push(request);
		if (channel === "tuxedo:set-todo-completion")
			return {
				status: "applied",
				confirmed: { scope, revision: 6, workspaceId, todo_file: contents(6).todo_file },
			};
		throw Error(`Unexpected ${channel}`);
	});
	const commands = new WorkspaceCommands(desktop, {
		catalogue: () => ({
			value: {
				status: "ready",
				catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
				selection: selection(5),
			},
			error: "",
		}),
		workspace: () => current,
		destination: () => workspaceId,
		navigating: () => false,
		refresh: async () => {
			entered();
			await released;
			current = { workspaceId, value: contents(6), error: "" };
		},
		navigate: async () => {},
	});
	const completing = commands.setCompletion(item);
	await refreshing;
	expect(commands.todoFile?.items[0].completed).toBe(false);
	expect(commands.isOperating).toBe(true);
	expect(commands.beginNavigation(new Promise(() => {}), "other")).toBe(false);
	expect(await commands.setCompletion(item)).toMatchObject({ status: "rejected" });
	expect(requests).toEqual([
		{ scope, revision: 5, workspaceId, lineNumber: 1, expectedRaw: "Call Mom", completed: true },
	]);
	publish();
	expect(await completing).toEqual({ status: "applied" });
	expect(commands.todoFile?.items[0].completed).toBe(true);
	expect(commands.isOperating).toBe(false);
	expect(commands.canMutate).toBe(true);
});

test("a committed completion with unpublished refresh blocks writes and retries only reads", async () => {
	let current: WorkspaceData = { workspaceId, value: contents(5), error: "" };
	let writes = 0;
	let reads = 0;
	const commands = new WorkspaceCommands(
		createDesktopClient(async (channel) => {
			if (channel !== "tuxedo:set-todo-completion") throw Error(`Unexpected ${channel}`);
			writes++;
			return {
				status: "applied",
				confirmed: { scope, revision: 6, workspaceId, todo_file: contents(6).todo_file },
			};
		}),
		{
			catalogue: () => ({
				value: {
					status: "ready",
					catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
					selection: selection(5),
				},
				error: "",
			}),
			workspace: () => current,
			destination: () => workspaceId,
			navigating: () => false,
			refresh: async () => {
				reads++;
				if (reads > 1) current = { workspaceId, value: contents(6), error: "" };
			},
			navigate: async () => {},
		}
	);
	expect(await commands.setCompletion(item)).toMatchObject({
		status: "applied",
		notice: expect.stringContaining("saved"),
	});
	expect(commands.isOperating).toBe(false);
	expect(commands.canMutate).toBe(false);
	expect(commands.todoFile?.items[0].completed).toBe(false);
	expect(await commands.setCompletion(item)).toMatchObject({ status: "rejected" });
	expect(await commands.retry()).toEqual({ status: "applied" });
	expect({ writes, reads }).toEqual({ writes: 1, reads: 2 });
	expect(commands.canMutate).toBe(true);
});

test("only the current committed destination activates; committed activation failure retries reads", async () => {
	let destination = workspaceId;
	let current: WorkspaceData = {
		workspaceId,
		value: { ...contents(5), provenance: { status: "speculative" as const } },
		error: "",
	};
	let activations = 0;
	let reads = 0;
	const commands = new WorkspaceCommands(
		createDesktopClient(async (channel) => {
			if (channel !== "tuxedo:switch-workspace") throw Error(`Unexpected ${channel}`);
			activations++;
			return {
				status: "applied",
				confirmed: {
					scope,
					revision: 6,
					session: {
						status: "ready",
						catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
						todo_file: contents(6).todo_file,
					},
				},
			};
		}),
		{
			catalogue: () => ({
				value: {
					status: "ready",
					catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
					selection: selection(6),
				},
				error: "",
			}),
			workspace: () => current,
			destination: () => destination,
			navigating: () => reads === 0,
			refresh: async () => {
				reads++;
				if (reads === 1) current = { ...current, error: "Read unavailable" };
				else current = { workspaceId, value: contents(6), error: "" };
			},
			navigate: async () => {},
		}
	);
	await commands.committedDestination("abandoned");
	expect(activations).toBe(0);
	await commands.committedDestination(destination);
	expect(activations).toBe(1);
	expect(commands.isOperating).toBe(false);
	expect(commands.canMutate).toBe(false);
	expect(await commands.retry()).toEqual({ status: "applied" });
	expect(activations).toBe(1);
	expect(commands.canMutate).toBe(true);
});

test("a stale same-Workspace publication revalidates its receipt without activating again", async () => {
	let current: WorkspaceData = { workspaceId, value: contents(5), error: "" };
	let reads = 0;
	let activations = 0;
	const commands = new WorkspaceCommands(
		createDesktopClient(async (channel) => {
			if (channel === "tuxedo:switch-workspace") {
				activations++;
				return { status: "rejected", message: "Unexpected activation" };
			}
			if (channel === "tuxedo:set-todo-completion")
				return {
					status: "applied",
					confirmed: { scope, revision: 6, workspaceId, todo_file: contents(6).todo_file },
				};
			throw Error(`Unexpected ${channel}`);
		}),
		{
			catalogue: () => ({
				value: {
					status: "ready",
					catalogue: { version: 1, active_workspace_id: workspaceId, workspaces: [workspace] },
					selection: selection(6),
				},
				error: "",
			}),
			workspace: () => current,
			destination: () => workspaceId,
			navigating: () => false,
			refresh: async () => {
				reads++;
				current = { workspaceId, value: contents(6), error: "" };
			},
			navigate: async () => {},
		}
	);
	expect(await commands.setCompletion(item)).toEqual({ status: "applied" });
	current = { workspaceId, value: contents(5), error: "" };
	await commands.committedDestination(workspaceId);
	expect({ reads, activations }).toEqual({ reads: 2, activations: 0 });
	expect(commands.canMutate).toBe(true);
});
