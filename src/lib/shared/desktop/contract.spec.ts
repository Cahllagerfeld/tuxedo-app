import { expect, test } from "vitest";
import { createDesktopClient } from "./contract";
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
