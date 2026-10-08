import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend } from "./session";
const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});
test("a fresh catalogue exposes an empty confirmed session without creating metadata", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-session-"));
	directories.push(directory);
	const backend = createSessionBackend(join(directory, "workspaces.json"));
	expect(await backend.readSession({})).toMatchObject({
		revision: 0,
		session: {
			status: "empty",
			catalogue: { version: 1, workspaces: [], active_workspace_id: null },
		},
	});
	await expect(readFile(join(directory, "workspaces.json"))).rejects.toMatchObject({
		code: "ENOENT",
	});
});
test.each([
	"{broken",
	'{"version":2,"workspaces":[],"active_workspace_id":null}',
	'{"version":1,"workspaces":[],"active_workspace_id":"9426bd98-a6dd-48eb-b1ab-037d82983ae1"}',
])("invalid catalogue is preserved and actionable (%s)", async (content) => {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-session-"));
	directories.push(directory);
	const path = join(directory, "workspaces.json");
	await writeFile(path, content);
	expect(await createSessionBackend(path).restoreSession({})).toMatchObject({
		session: { status: "unavailable", error: expect.stringContaining(path) },
	});
	expect(await readFile(path, "utf8")).toBe(content);
});
test("read-only session queries retain confirmed data while explicit restoration advances revisions", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-session-"));
	directories.push(directory);
	const path = join(directory, "workspaces.json");
	const backend = createSessionBackend(path);
	const first = await backend.readSession({});
	await writeFile(path, "invalid");
	expect(await backend.readSession({})).toEqual(first);
	expect(await backend.restoreSession({})).toMatchObject({
		scope: first.scope,
		revision: 1,
		session: { status: "unavailable" },
	});
});
test.each(["duplicate-name", "untrimmed-name", "empty-path"])(
	"catalogue domain invariant %s is rejected without replacement",
	async (invariant) => {
		const directory = await mkdtemp(join(tmpdir(), "tuxedo-session-"));
		directories.push(directory);
		const path = join(directory, "workspaces.json");
		const workspace = {
			id: "9426bd98-a6dd-48eb-b1ab-037d82983ae1",
			name: "Work",
			color: "blue",
			todo_path: "/tmp/work.todo",
			created_at: "2026-07-10T10:00:00Z",
		};
		const workspaces =
			invariant === "duplicate-name"
				? [
						workspace,
						{
							...workspace,
							id: "550e8400-e29b-41d4-a716-446655440000",
							name: "work",
							todo_path: "/tmp/other.todo",
						},
					]
				: [
						{
							...workspace,
							...(invariant === "untrimmed-name" ? { name: " Work " } : { todo_path: "   " }),
						},
					];
		const content = JSON.stringify({ version: 1, active_workspace_id: null, workspaces });
		await writeFile(path, content);
		expect(await createSessionBackend(path).readSession({})).toMatchObject({
			session: { status: "unavailable" },
		});
		expect(await readFile(path, "utf8")).toBe(content);
	}
);
test("an unreadable catalogue remains unavailable without replacing its location", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-session-"));
	directories.push(directory);
	expect(await createSessionBackend(directory).readSession({})).toMatchObject({
		session: { status: "unavailable", error: expect.stringContaining("Check its permissions") },
	});
});
