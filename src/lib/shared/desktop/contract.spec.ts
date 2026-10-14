import { expect, test } from "vitest";
import { createDesktopClient, desktopContract, todoFileChangeEvent } from "./contract";
test("desktop transport rejects malformed responses", async () => {
	const desktop = createDesktopClient(async () => ({ revision: 0 }));
	await expect(desktop.readSession({})).rejects.toThrow();
});
test("desktop transport rejects unsupported request fields before invoking IPC", async () => {
	let invoked = false;
	const desktop = createDesktopClient(async () => {
		invoked = true;
		throw Error("should not invoke");
	});
	await expect(desktop.readSession({ path: "/etc/passwd" } as never)).rejects.toThrow();
	expect(invoked).toBe(false);
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
	priority: "Z",
	creationDate: null,
	completed: true,
	completionDate: "2026-10-09",
	metadata: ["custom:value"],
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
	{ ...createTodoRequest, contexts: ["phone home"] },
	{ ...createTodoRequest, contexts: ["phone\u0085home"] },
	{ ...createTodoRequest, description: "Call\u0085+Work" },
	{
		...createTodoRequest,
		description: "\u0085",
		creationDate: null,
		completed: false,
		completionDate: null,
		priority: null,
		metadata: [],
		projects: [],
		contexts: [],
	},
	{
		...createTodoRequest,
		description: "   ",
		creationDate: null,
		completed: false,
		completionDate: null,
		priority: null,
		metadata: [],
		projects: [],
		contexts: [],
	},
])("desktop transport rejects malformed create Todo requests %#", async (request) => {
	let invocations = 0;
	const desktop = createDesktopClient(async () => {
		invocations++;
		return { status: "applied", confirmed: confirmedTodo };
	});
	await expect(desktop.createTodo(request)).rejects.toThrow();
	expect(invocations).toBe(0);
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

test("desktop transport validates and forwards an edit with its original line target", async () => {
	const input = { ...createTodoRequest, lineNumber: 2, expectedRaw: "Old +Home" };
	let invoked: { channel: string; request: unknown } | undefined;
	const response = { status: "applied", confirmed: confirmedTodo };
	const client = createDesktopClient(async (channel, request) => {
		invoked = { channel, request };
		return response;
	});
	expect(await client.editTodo(input)).toEqual(response);
	expect(invoked).toEqual({ channel: "tuxedo:edit-todo", request: input });
});
test("edits must explicitly preserve or clear Creation date", async () => {
	let invoked = false;
	const client = createDesktopClient(async () => {
		invoked = true;
		throw Error("unexpected");
	});
	const { creationDate, ...input } = createTodoRequest;
	await expect(
		client.editTodo({ ...input, lineNumber: 1, expectedRaw: "Old" } as never)
	).rejects.toThrow();
	expect(invoked).toBe(false);
});

test.each([null, [], "", 1, { unexpected: true }])(
	"empty desktop requests reject non-object or expanded input %#",
	async (input) => {
		let invoked = false;
		const desktop = createDesktopClient(async () => {
			invoked = true;
			return { scope, revision: 1, session: { status: "unavailable", error: "Unavailable" } };
		});
		await expect(desktop.readSession(input as never)).rejects.toThrow();
		expect(invoked).toBe(false);
	}
);

test.each([
	{ ...catalogue, active_workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
	{
		...catalogue,
		workspaces: [
			...catalogue.workspaces,
			{ ...catalogue.workspaces[0], name: "Other", todo_path: "/tmp/other.todo" },
		],
	},
	{
		...catalogue,
		workspaces: [
			...catalogue.workspaces,
			{
				...catalogue.workspaces[0],
				id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				name: "work",
				todo_path: "/tmp/other.todo",
			},
		],
	},
	{
		...catalogue,
		workspaces: [
			...catalogue.workspaces,
			{ ...catalogue.workspaces[0], id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Other" },
		],
	},
	{ ...catalogue, unexpected: true },
	...[
		{ name: " Work " },
		{ todo_path: " " },
		{ color: "purple" },
		{ id: "not-a-uuid" },
		{ created_at: "2026-02-30T10:00:00Z" },
		{ created_at: "2026-01-01T10:00:00" },
		{ created_at: "2026-01-01T24:00:00Z" },
		{ created_at: "2026-01-01T10:00:00+24:00" },
		{ unexpected: true },
	].map((fields) => ({ ...catalogue, workspaces: [{ ...catalogue.workspaces[0], ...fields }] })),
])("desktop responses reject malformed catalogue data %#", async (invalidCatalogue) => {
	const desktop = createDesktopClient(async () => ({
		scope,
		revision: 1,
		session: { status: "empty", catalogue: invalidCatalogue, warning: null },
	}));
	await expect(desktop.readSession({})).rejects.toThrow();
});

test.each(["2024-02-29T10:00:00Z", "2026-10-12T10:00:00.123+02:00", "2026-10-12T10:00:00-05:30"])(
	"desktop catalogue timestamps retain timezone and fractional-second compatibility %s",
	async (created_at) => {
		const response = {
			scope,
			revision: 1,
			session: {
				status: "empty",
				catalogue: { ...catalogue, workspaces: [{ ...catalogue.workspaces[0], created_at }] },
				warning: null,
			},
		};
		expect(await createDesktopClient(async () => response).readSession({})).toEqual(response);
	}
);

test("Workspace requests trim names while retaining the exact Todo-file reference", async () => {
	let forwarded: unknown;
	const response = { status: "rejected", message: "Already exists" };
	const desktop = createDesktopClient(async (_, request) => {
		forwarded = request;
		return response;
	});
	expect(
		await desktop.createWorkspace({ name: " Work ", color: "blue", todoPath: " /tmp/work.todo " })
	).toEqual(response);
	expect(forwarded).toEqual({ name: "Work", color: "blue", todoPath: " /tmp/work.todo " });
});

test.each([-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
	"desktop responses reject invalid revisions %s",
	async (revision) => {
		const desktop = createDesktopClient(async () => ({
			scope,
			revision,
			session: { status: "unavailable", error: "Unavailable" },
		}));
		await expect(desktop.readSession({})).rejects.toThrow();
	}
);

test("clipboard transport preserves exact text and validates acknowledgement", async () => {
	const text = "  (A) Café\t+Launch  @home\u00a0due:2026-10-14  ";
	let forwarded: unknown;
	const desktop = createDesktopClient(async (channel, request) => {
		expect(channel).toBe("tuxedo:write-clipboard-text");
		forwarded = request;
		return null;
	});
	await expect(desktop.writeClipboardText({ text })).resolves.toBeNull();
	expect(forwarded).toEqual({ text });
	await expect(
		createDesktopClient(async () => true).writeClipboardText({ text })
	).rejects.toThrow();
	await expect(
		createDesktopClient(async () => {
			throw Error("clipboard unavailable");
		}).writeClipboardText({ text })
	).rejects.toThrow("clipboard unavailable");
});

test.each([{}, { text: 42 }, { text: "hello", read: true }])(
	"clipboard contract rejects malformed requests %#",
	(request) => {
		expect(() => desktopContract.writeClipboardText.request.parse(request)).toThrow();
	}
);
