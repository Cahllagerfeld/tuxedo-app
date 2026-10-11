import { expect, test } from "vitest";
import { createDesktopClient, todoFileChangeEvent } from "./contract";
test("desktop transport rejects malformed responses", async () => {
	const desktop = createDesktopClient(async () => ({ revision: 0 }));
	await expect(desktop.readSession({})).rejects.toThrow();
});
test("desktop transport rejects unsupported request fields before invoking IPC", async () => {
	const desktop = createDesktopClient(async () => {
		throw Error("should not invoke");
	});
	await expect(desktop.readSession({ path: "/etc/passwd" } as never)).rejects.toThrow(
		"Unrecognized key"
	);
});

const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const workspaceId = "550e8400-e29b-41d4-a716-446655440000";
const changeSignal = { scope, revision: 1, workspaceId, todoPath: "/tmp/work.todo" };
test("Todo-file observation contract accepts a scoped Active Todo-file signal", () => {
	expect(todoFileChangeEvent.payload.parse(changeSignal)).toEqual(changeSignal);
});
test.each([
	{ ...changeSignal, scope: "unscoped" },
	{ ...changeSignal, workspaceId: "unknown" },
	{ ...changeSignal, revision: -1 },
	{ ...changeSignal, revision: 1.5 },
	{ ...changeSignal, todoPath: "" },
	{ ...changeSignal, cataloguePath: "/tmp/workspaces.json" },
	{ scope, revision: 1, workspaceId },
])("Todo-file observation contract rejects malformed or expanded signals %#", (payload) => {
	expect(() => todoFileChangeEvent.payload.parse(payload)).toThrow();
});
const catalogue = {
	version: 1,
	active_workspace_id: workspaceId,
	workspaces: [
		{
			id: workspaceId,
			name: "Work",
			color: "blue",
			todo_path: "/tmp/work.todo",
			created_at: "2026-07-10T10:00:00Z",
		},
	],
};
const todo_file = { path: "/tmp/work.todo", items: [], skipped: [] };
test.each([
	{
		status: "empty",
		catalogue: { version: 1, active_workspace_id: null, workspaces: [] },
		warning: null,
	},
	{ status: "empty", catalogue, warning: "Cannot open /tmp/work.todo" },
	{ status: "ready", catalogue, todo_file },
	{ status: "unavailable", error: "Cannot read catalogue" },
])("desktop transport accepts coherent session $status", async (session) => {
	const response = { scope, revision: 1, session };
	const desktop = createDesktopClient(async () => response);
	expect(await desktop.readSession({})).toEqual(response);
});
test.each([
	{ status: "ready", catalogue },
	{ status: "ready", catalogue, todo_file: { ...todo_file, path: "/tmp/other.todo" } },
	{ status: "ready", catalogue: { ...catalogue, active_workspace_id: null }, todo_file },
	{ status: "empty", catalogue: { ...catalogue, version: 2 }, warning: null },
	{ status: "empty", catalogue, warning: null, todo_file },
	{ status: "unavailable", error: "" },
])("desktop transport rejects malformed/coherently mismatched session %#", async (session) => {
	const desktop = createDesktopClient(async () => ({ scope, revision: 1, session }));
	await expect(desktop.readSession({})).rejects.toThrow();
});

const createTodoRequest = {
	scope,
	revision: 1,
	workspaceId,
	description: "Buy milk",
	projects: ["Home"],
	contexts: ["errands"],
};
const confirmedTodo = {
	scope,
	revision: 2,
	workspaceId,
	todo_file,
};
test("desktop transport validates and forwards a create Todo mutation", async () => {
	let invoked: { channel: string; request: unknown } | undefined;
	const response = { status: "applied" as const, confirmed: confirmedTodo };
	const desktop = createDesktopClient(async (channel, request) => {
		invoked = { channel, request };
		return response;
	});

	expect(await desktop.createTodo(createTodoRequest)).toEqual(response);
	expect(invoked).toEqual({
		channel: "tuxedo:create-todo",
		request: createTodoRequest,
	});
});
test.each([
	{ ...createTodoRequest, projects: ["Home", "Home"] },
	{ ...createTodoRequest, contexts: ["errands", "errands"] },
	{ ...createTodoRequest, projects: ["+Home"] },
	{ ...createTodoRequest, contexts: ["phone home"] },
	{ ...createTodoRequest, contexts: ["phone\u0085home"] },
	{ ...createTodoRequest, description: "Call\u0085+Work" },
	{ ...createTodoRequest, description: "\u0085" },
	{ ...createTodoRequest, description: "   " },
])("desktop transport rejects malformed create Todo requests %#", async (request) => {
	const desktop = createDesktopClient(async () => {
		throw Error("should not invoke");
	});
	await expect(desktop.createTodo(request)).rejects.toThrow();
});
test("desktop transport rejects malformed create Todo responses", async () => {
	const desktop = createDesktopClient(async () => ({
		status: "applied",
		confirmed: { ...confirmedTodo, todo_file: { ...todo_file, path: "" } },
	}));
	await expect(desktop.createTodo(createTodoRequest)).rejects.toThrow();
});

test("desktop transport validates a reorder and rejects duplicate positions before IPC", async () => {
	let invoked: { channel: string; request: unknown } | undefined;
	const response = { status: "applied" as const, confirmed: confirmedTodo };
	const desktop = createDesktopClient(async (channel, request) => {
		invoked = { channel, request };
		return response;
	});
	const request = { scope, revision: 1, workspaceId, lineNumbers: [3, 1] };
	expect(await desktop.reorderTodo(request)).toEqual(response);
	expect(invoked).toEqual({ channel: "tuxedo:reorder-todo", request });
	invoked = undefined;
	await expect(desktop.reorderTodo({ ...request, lineNumbers: [1, 1] })).rejects.toThrow("unique");
	expect(invoked).toBeUndefined();
});
