import { expect, test } from "vitest";
import {
	createDesktopClient,
	desktopContract,
	savedViewsFileSchema,
	todoFileChangeEvent,
} from "@tuxedo/contracts";

test("Workspace setup validates creation authorization and Save-selection responses", async () => {
	const request = {
		name: "Work",
		color: "blue",
		todoPath: "/tmp/work.txt",
		creationToken: "550e8400-e29b-41d4-a716-446655440000",
	};
	for (const invalid of [
		{ ...request, creationToken: "yes" },
		{ ...request, replaceExisting: true },
	])
		expect(() => desktopContract.createWorkspace.request.parse(invalid)).toThrow();
	await expect(
		createDesktopClient(async () => ({ todoPath: request.todoPath })).selectNewTodoFile({})
	).rejects.toThrow();
	expect(await createDesktopClient(async () => null).selectNewTodoFile({})).toBeNull();
});
test.each([true, false])(
	"bulk completion transport validates the explicit completion state %s",
	async (completed) => {
		let forwarded: unknown;
		const desktop = createDesktopClient(async (channel, request) => {
			forwarded = { channel, request };
			return { status: "rejected", message: "Read-only file" };
		});
		const request = {
			scope,
			revision: 1,
			workspaceId,
			completed,
			targets: [{ lineNumber: 1, expectedRaw: "Item" }],
		};
		await desktop.bulkSetTodoCompletion(request);
		expect(forwarded).toEqual({ channel: "tuxedo:bulk-set-todo-completion", request });
		const { completed: _, ...missing } = request;
		for (const invalid of [
			missing,
			{ ...request, completed: "false" },
			{ ...request, targets: [] },
			{ ...request, targets: [request.targets[0], request.targets[0]] },
		])
			expect(() => desktopContract.bulkSetTodoCompletion.request.parse(invalid)).toThrow();
	}
);

test("desktop transport rejects malformed responses", async () => {
	const desktop = createDesktopClient(async () => ({ revision: 0 }));
	await expect(desktop.switchWorkspace({ workspaceId })).rejects.toThrow();
});
test("Workspace reads validate saved identities, coherent Todo files and confirmation tokens", async () => {
	const response = {
		status: "ready",
		workspace: catalogue.workspaces[0],
		todo_file: { path: catalogue.workspaces[0].todo_path, items: [], skipped: [] },
		confirmation: { scope, revision: 2, undoLabel: "Undo edit" },
	};
	let forwarded: unknown;
	const desktop = createDesktopClient(async (channel, request) => {
		forwarded = { channel, request };
		return response;
	});
	expect(await desktop.readWorkspace({ workspaceId })).toEqual(response);
	expect(forwarded).toEqual({ channel: "tuxedo:read-workspace", request: { workspaceId } });
	expect(
		await createDesktopClient(async () => ({ ...response, confirmation: null })).readWorkspace({
			workspaceId,
		})
	).toEqual({ ...response, confirmation: null });
	for (const invalid of [
		{ ...response, todo_file: { ...response.todo_file, path: "/tmp/another.txt" } },
		{ ...response, confirmation: { scope, revision: -1 } },
		{ ...response, confirmation: { scope: "invalid", revision: 2 } },
	])
		await expect(
			createDesktopClient(async () => invalid).readWorkspace({ workspaceId })
		).rejects.toThrow();
	for (const invalid of [{ workspaceId: "invalid" }, { workspaceId, todoPath: "/etc/passwd" }])
		expect(() => desktopContract.readWorkspace.request.parse(invalid)).toThrow();
});
test("sort-order transport validates requests and confirmed Workspace preferences", async () => {
	let forwarded: unknown;
	const desktop = createDesktopClient(async (channel, request) => {
		forwarded = { channel, request };
		return { status: "rejected", message: "Read-only catalogue" };
	});
	const request = { scope, revision: 1, workspaceId, sortOrder: "due" as const };
	expect(await desktop.setWorkspaceSortOrder(request)).toEqual({
		status: "rejected",
		message: "Read-only catalogue",
	});
	expect(forwarded).toEqual({ channel: "tuxedo:set-workspace-sort-order", request });
	for (const invalid of [
		{ ...request, sortOrder: "priority" },
		{ ...request, revision: -1 },
		{ ...request, path: "/tmp/file" },
	]) {
		expect(() => desktopContract.setWorkspaceSortOrder.request.parse(invalid)).toThrow();
	}
	const response = {
		status: "applied",
		confirmed: {
			scope,
			revision: 2,
			session: {
				status: "empty",
				catalogue: {
					...catalogue,
					workspaces: catalogue.workspaces.map((w) => ({ ...w, sort_order: "due" })),
				},
				warning: null,
			},
		},
	};
	expect(await createDesktopClient(async () => response).setWorkspaceSortOrder(request)).toEqual(
		response
	);
	const invalid = {
		...catalogue,
		workspaces: catalogue.workspaces.map((w) => ({ ...w, sort_order: "priority" })),
	};
	await expect(
		createDesktopClient(async () => ({
			...response,
			confirmed: {
				...response.confirmed,
				session: { ...response.confirmed.session, catalogue: invalid },
			},
		})).setWorkspaceSortOrder(request)
	).rejects.toThrow();
});
test("Workspace visibility transport validates requests and confirmed Workspace preferences", async () => {
	let forwarded: unknown;
	const desktop = createDesktopClient(async (channel, request) => {
		forwarded = { channel, request };
		return { status: "rejected", message: "Read-only catalogue" };
	});
	const request = { scope, revision: 1, workspaceId, showDeferred: true };
	expect(await desktop.setWorkspaceShowDeferred(request)).toEqual({
		status: "rejected",
		message: "Read-only catalogue",
	});
	expect(forwarded).toEqual({ channel: "tuxedo:set-workspace-show-deferred", request });
	for (const invalid of [
		{ ...request, showDeferred: "true" },
		{ ...request, revision: -1 },
		{ ...request, path: "/tmp/file" },
	]) {
		expect(() => desktopContract.setWorkspaceShowDeferred.request.parse(invalid)).toThrow();
	}
	const response = {
		status: "applied",
		confirmed: {
			scope,
			revision: 2,
			session: {
				status: "empty",
				catalogue: {
					...catalogue,
					workspaces: catalogue.workspaces.map((w) => ({ ...w, show_deferred: true })),
				},
				warning: null,
			},
		},
	};
	expect(await createDesktopClient(async () => response).setWorkspaceShowDeferred(request)).toEqual(
		response
	);
	const invalid = {
		...catalogue,
		workspaces: catalogue.workspaces.map((w) => ({ ...w, show_deferred: "true" })),
	};
	await expect(
		createDesktopClient(async () => ({
			...response,
			confirmed: {
				...response.confirmed,
				session: { ...response.confirmed.session, catalogue: invalid },
			},
		})).setWorkspaceShowDeferred(request)
	).rejects.toThrow();
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
const todo_item = {
	line_number: 1,
	raw: "Buy milk",
	completed: false,
	priority: null,
	creation_date: null,
	completion_date: null,
	description: "Buy milk",
	projects: [],
	contexts: [],
	metadata: {},
	edit: { description: "Buy milk", metadata: [] },
};
const todo_file = { path: "/tmp/work.todo", items: [todo_item], skipped: [] };
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
	const desktop = createDesktopClient(async () => ({ status: "applied", confirmed: response }));
	expect(await desktop.switchWorkspace({ workspaceId })).toEqual({
		status: "applied",
		confirmed: response,
	});
});
test.each([
	{ status: "ready", catalogue },
	{ status: "ready", catalogue, todo_file: { ...todo_file, path: "/tmp/other.todo" } },
	{ status: "ready", catalogue: { ...catalogue, active_workspace_id: null }, todo_file },
	{ status: "empty", catalogue: { ...catalogue, version: 2 }, warning: null },
	{ status: "empty", catalogue, warning: null, todo_file },
	{ status: "unavailable", error: "" },
])("desktop transport rejects malformed/coherently mismatched session %#", async (session) => {
	const desktop = createDesktopClient(async () => ({
		status: "applied",
		confirmed: { scope, revision: 1, session },
	}));
	await expect(desktop.switchWorkspace({ workspaceId })).rejects.toThrow();
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
test("desktop transport forwards scoped Undo and validates its availability label", async () => {
	const request = { scope, revision: 2, workspaceId };
	const calls: unknown[] = [];
	const desktop = createDesktopClient(async (channel, input) => {
		calls.push({ channel, input });
		return { status: "applied", confirmed: confirmedTodo };
	});
	expect(await desktop.undoTodo(request)).toEqual({ status: "applied", confirmed: confirmedTodo });
	expect(calls).toEqual([{ channel: "tuxedo:undo-todo", input: request }]);
	await expect(desktop.undoTodo({ ...request, revision: -1 })).rejects.toThrow();
	expect(calls).toHaveLength(1);
	const malformed = createDesktopClient(async () => ({
		status: "applied",
		confirmed: { ...confirmedTodo, undoLabel: "Undo everything" },
	}));
	await expect(malformed.undoTodo(request)).rejects.toThrow();
});
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
test.each([
	{ ...todo_file, path: "" },
	{ ...todo_file, items: [{ ...todo_item, line_number: "1" }] },
	{ ...todo_file, skipped: [{ line_number: 2, raw: "Invalid", reason: null }] },
])("desktop transport rejects malformed Todo-file responses %#", async (todo_file) => {
	const desktop = createDesktopClient(async () => ({
		status: "applied",
		confirmed: { ...confirmedTodo, todo_file },
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

test("desktop transport validates board destinations and the scoped item target", async () => {
	let invoked: { channel: string; request: unknown } | undefined;
	const desktop = createDesktopClient(async (channel, request) => {
		invoked = { channel, request };
		return { status: "rejected", message: "Read-only file" };
	});
	const request = {
		scope,
		revision: 1,
		workspaceId,
		lineNumber: 1,
		expectedRaw: "Plan",
		column: "to-do" as const,
	};
	await desktop.moveTodoOnBoard(request);
	expect(invoked).toEqual({ channel: "tuxedo:move-todo-on-board", request });
	for (const invalid of [
		{ ...request, column: "done" },
		{ ...request, column: "in-progress/2" },
		{ ...request, lineNumber: 0 },
		{ ...request, extra: true },
	])
		expect(() => desktopContract.moveTodoOnBoard.request.parse(invalid)).toThrow();
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
		expect(
			await createDesktopClient(async () => ({
				status: "applied",
				confirmed: response,
			})).switchWorkspace({ workspaceId })
		).toEqual({ status: "applied", confirmed: response });
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
			status: "applied",
			confirmed: { scope, revision, session: { status: "unavailable", error: "Unavailable" } },
		}));
		await expect(desktop.switchWorkspace({ workspaceId })).rejects.toThrow();
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

test.each([
	{ status: "open", search: "", project: null, context: null, priority: "AA", due: null },
	{ status: "open", search: "", project: " work ", context: null, priority: null, due: null },
	{ status: "open", search: "", project: null, context: " ", priority: null, due: null },
	{ status: "completed", search: "", project: null, context: null, priority: null, due: "today" },
	{ status: "open", search: "", project: null, context: null, priority: null, due: "tomorrow" },
	{
		status: "open",
		search: "",
		project: null,
		context: null,
		priority: null,
		due: null,
		path: "/tmp/file",
	},
])("saved-view transport rejects invalid filters before IPC %#", async (filters) => {
	let invoked = false;
	const desktop = createDesktopClient(async () => {
		invoked = true;
		return null;
	});
	await expect(desktop.saveView({ workspaceId, name: "View", filters } as never)).rejects.toThrow();
	expect(invoked).toBe(false);
	expect(() =>
		savedViewsFileSchema.parse({
			version: 1,
			views: [{ id: scope, workspace_id: workspaceId, name: "View", filters }],
		})
	).toThrow();
});
test("saved-view transport validates persisted view responses", async () => {
	const desktop = createDesktopClient(async () => ({
		status: "applied",
		workspaceId,
		views: [{ id: scope, workspace_id: workspaceId, name: "View", filters: {} }],
	}));
	await expect(desktop.readSavedViews({ workspaceId })).rejects.toThrow();
});

test("session RPC returns one coherent confirmed snapshot", async () => {
	const response = { scope, revision: 2, session: { status: "ready", catalogue, todo_file } };
	let forwarded: unknown;
	const client = createDesktopClient(async (channel, request) => {
		forwarded = { channel, request };
		return response;
	});
	expect(await client.readSession({})).toEqual(response);
	expect(forwarded).toEqual({ channel: "tuxedo:read-session", request: {} });
	await expect(
		createDesktopClient(async () => ({
			...response,
			session: { ...response.session, todo_file: { ...todo_file, path: "/tmp/other" } },
		})).readSession({})
	).rejects.toThrow();
});

test("saved-view responses contain only their identified Workspace's views", () => {
	const filters = {
		status: "open",
		search: "",
		project: null,
		context: null,
		priority: null,
		due: null,
	};
	const response = {
		status: "applied",
		workspaceId,
		views: [{ id: scope, workspace_id: workspaceId, name: "View", filters }],
	};
	expect(desktopContract.readSavedViews.response.parse(response)).toEqual(response);
	expect(() =>
		desktopContract.readSavedViews.response.parse({
			...response,
			workspaceId: scope,
		})
	).toThrow();
});

test.each(["One\rTwo", "One\r", "\uFEFF"])(
	"batch deletion accepts parser-supported raw content %j",
	(expectedRaw) => {
		const request = {
			scope,
			revision: 1,
			workspaceId,
			targets: [{ lineNumber: 1, expectedRaw }],
		};
		expect(desktopContract.bulkDeleteTodos.request.parse(request)).toEqual(request);
	}
);

test("batch deletion transport validates targets before IPC and validates every response", async () => {
	let calls = 0;
	const request = {
		scope,
		revision: 1,
		workspaceId,
		targets: [{ lineNumber: 1, expectedRaw: "One" }],
	};
	const response = {
		status: "applied",
		confirmed: {
			scope,
			revision: 2,
			workspaceId,
			undoLabel: "Undo deletion",
			todo_file: { path: "/tmp/todo.txt", items: [], skipped: [] },
		},
	};
	const desktop = createDesktopClient(async (channel, forwarded) => {
		calls++;
		expect(channel).toBe("tuxedo:bulk-delete-todos");
		expect(forwarded).toEqual(request);
		return response;
	});
	expect(await desktop.bulkDeleteTodos(request)).toEqual(response);
	for (const invalid of [
		{ ...request, targets: [] },
		{ ...request, targets: [request.targets[0], request.targets[0]] },
		{ ...request, targets: [{ lineNumber: 0, expectedRaw: "One" }] },
		...["", " ", "\r", "\u0085", " \u2003\r", "One\nTwo"].map((expectedRaw) => ({
			...request,
			targets: [{ lineNumber: 1, expectedRaw }],
		})),
		{ ...request, scope: "invalid" },
		{ ...request, workspaceId: "invalid" },
		{ ...request, revision: -1 },
		{ ...request, extra: true },
		{ ...request, targets: [{ ...request.targets[0], extra: true }] },
	]) {
		expect(() => desktopContract.bulkDeleteTodos.request.parse(invalid)).toThrow();
	}
	await expect(desktop.bulkDeleteTodos({ ...request, targets: [] })).rejects.toThrow();
	expect(calls).toBe(1);
	for (const invalid of [
		{ status: "applied" },
		{ ...response, confirmed: { ...response.confirmed, revision: -1 } },
		{ ...response, extra: true },
	]) {
		await expect(
			createDesktopClient(async () => invalid).bulkDeleteTodos(request)
		).rejects.toThrow();
	}
});

test("bulk completion transport validates unique physical-line targets", () => {
	expect(() =>
		desktopContract.bulkSetTodoCompletion.request.parse({
			scope,
			revision: 1,
			workspaceId,
			targets: [
				{ lineNumber: 1, expectedRaw: "One" },
				{ lineNumber: 1, expectedRaw: "Two" },
			],
		})
	).toThrow();
});

test("completion transport carries validated recurrence feedback for checkbox, editor, and bulk completion", async () => {
	const response = {
		status: "applied",
		notice: "Next occurrence due 2028-02-29.",
		confirmed: {
			scope,
			revision: 2,
			workspaceId,
			todo_file: { path: "/tmp/todo.txt", items: [], skipped: [] },
		},
	};
	for (const operation of ["setTodoCompletion", "editTodo", "bulkSetTodoCompletion"] as const) {
		expect(desktopContract[operation].response.parse(response)).toEqual(response);
		for (const notice of ["", 123, { due: "2028-02-29" }])
			expect(() => desktopContract[operation].response.parse({ ...response, notice })).toThrow();
	}
});
