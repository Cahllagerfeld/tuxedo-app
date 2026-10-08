import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, readFile, realpath, chmod } from "node:fs/promises";
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
test("creation reads and parses the Todo file before atomically saving an active Workspace", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-create-"));
	directories.push(directory);
	const todoPath = join(await realpath(directory), "todo.txt");
	const cataloguePath = join(directory, "workspaces.json");
	await writeFile(
		todoPath,
		"  (A) 2026-05-24 Call Mom +Family @phone due:tomorrow  \r\nx 2026-05-25 (B) 2026-05-24 Finished\n"
	);
	const backend = createSessionBackend(cataloguePath);
	const outcome = await backend.createWorkspace({ name: "  Personal  ", color: "blue", todoPath });
	expect(outcome.status).toBe("applied");
	if (outcome.status !== "applied") throw Error(outcome.message);
	expect(outcome.confirmed.session).toMatchObject({
		status: "ready",
		catalogue: { workspaces: [{ name: "Personal", todo_path: todoPath }] },
		todo_file: {
			path: todoPath,
			items: [
				{
					raw: "  (A) 2026-05-24 Call Mom +Family @phone due:tomorrow  ",
					line_number: 1,
					priority: "A",
					creation_date: "2026-05-24",
					description: "Call Mom",
					projects: ["Family"],
					contexts: ["phone"],
					metadata: { due: "tomorrow" },
				},
				{ completed: true, completion_date: "2026-05-25", priority: "B" },
			],
			skipped: [],
		},
	});
	const saved = JSON.parse(await readFile(cataloguePath, "utf8"));
	expect(saved.active_workspace_id).toBe(saved.workspaces[0].id);
	expect(await backend.readSession({})).toEqual(outcome.confirmed);
	expect((await createSessionBackend(cataloguePath).restoreSession({})).session).toEqual(
		outcome.confirmed.session
	);
});
test.each([
	"invalid-date",
	"metadata-only",
	"missing-file",
	"blank-name",
	"bad-color",
	"duplicate-name",
	"duplicate-path",
	"invalid-utf8",
	"save-failure",
])("rejected creation (%s) preserves metadata and the confirmed session", async (failure) => {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-rejected-"));
	directories.push(directory);
	const path = join(directory, "workspaces.json");
	const todoPath = join(directory, "first.todo");
	await writeFile(todoPath, "First item\n");
	const backend = createSessionBackend(path);
	const first = await backend.createWorkspace({ name: "First", color: "blue", todoPath });
	if (first.status !== "applied") throw Error(first.message);
	const before = await readFile(path, "utf8");
	const otherPath = join(directory, "second.todo");
	await writeFile(
		otherPath,
		failure === "invalid-date"
			? "2026-02-30 Impossible"
			: failure === "metadata-only"
				? "+Only @context"
				: failure === "invalid-utf8"
					? Buffer.from([0xff])
					: "Second item"
	);
	if (failure === "save-failure") await chmod(directory, 0o500);
	const result = await backend.createWorkspace({
		name: failure === "blank-name" ? "  " : failure === "duplicate-name" ? "first" : "Second",
		color: failure === "bad-color" ? ("purple" as "blue") : "green",
		todoPath:
			failure === "missing-file"
				? join(directory, "absent")
				: failure === "duplicate-path"
					? todoPath
					: otherPath,
	});
	if (failure === "save-failure") await chmod(directory, 0o700);
	expect(result.status).toBe("rejected");
	expect(await backend.readSession({})).toEqual(first.confirmed);
	expect(await readFile(path, "utf8")).toBe(before);
	await expect((await import("node:fs/promises")).readdir(directory)).resolves.not.toContain(
		expect.stringMatching(/\.tmp$/)
	);
});
test("restoration preserves Rust parser fixtures, skipped lines, and exact source values", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-parser-"));
	directories.push(directory);
	const path = join(directory, "workspaces.json");
	const todoPath = join(directory, "todo.txt");
	await writeFile(todoPath, "Seed");
	const backend = createSessionBackend(path);
	const created = await backend.createWorkspace({ name: "Parser", color: "cyan", todoPath });
	if (created.status !== "applied") throw Error(created.message);
	await writeFile(todoPath, await readFile("src-tauri/tests/fixtures/mixed_real_world.todo.txt"));
	const restored = await backend.restoreSession({});
	expect(restored.session.status).toBe("ready");
	if (restored.session.status !== "ready") throw Error("No file");
	expect(restored.session.todo_file.items).toHaveLength(5);
	expect(restored.session.todo_file.items[0]).toMatchObject({
		line_number: 1,
		priority: "A",
		creation_date: "2026-05-24",
		description: "Ship parser fixture",
		projects: ["TuxedoApp"],
		contexts: ["computer"],
		metadata: { due: "2026-05-25", pri: "A" },
	});
	expect(restored.session.todo_file.skipped).toEqual([
		{
			line_number: 4,
			raw: "2026-13-01 Impossible creation date +Broken",
			reason: "date must use YYYY-MM-DD format",
		},
		{
			line_number: 5,
			raw: "x 2026-99-99 Impossible completion date +Broken",
			reason: "date must use YYYY-MM-DD format",
		},
		{
			line_number: 6,
			raw: "+OnlyMetadata @only due:2026-05-25",
			reason: "task description is empty",
		},
	]);
	await writeFile(todoPath, await readFile("src-tauri/tests/fixtures/spec_examples.todo.txt"));
	const examples = await backend.restoreSession({});
	if (examples.session.status !== "ready") throw Error("No examples");
	expect(examples.session.todo_file.items).toHaveLength(18);
	expect(examples.session.todo_file.skipped).toEqual([]);
	expect(examples.session.todo_file.items[11]).toMatchObject({
		completed: true,
		completion_date: "2011-03-02",
		creation_date: "2011-03-01",
	});
});
test("restoration keeps physical lines, marker grammar, and exact repeated facets", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-grammar-"));
	directories.push(directory);
	const path = join(directory, "workspaces.json"),
		todoPath = join(directory, "todo.txt");
	await writeFile(todoPath, "Seed");
	const backend = createSessionBackend(path);
	await backend.createWorkspace({ name: "Grammar", color: "pink", todoPath });
	await writeFile(
		todoPath,
		"\n  (C) Call   Mom +Work +work +Work @Phone @phone key:first key:last key:value:extra + @  \r\nxylophone\nX 2012-01-01 Make resolutions\n(A) x Find tickets\nx\tNo marker\n(B)->No priority\n(b) Lowercase\nx 2000-02-29 (A) 1999-01-01 Finished\n1900-02-29 Invalid\n+Only @tag\n"
	);
	const result = await backend.restoreSession({});
	if (result.session.status !== "ready") throw Error("No grammar");
	const file = result.session.todo_file;
	expect(file.items[0]).toMatchObject({
		line_number: 2,
		raw: "  (C) Call   Mom +Work +work +Work @Phone @phone key:first key:last key:value:extra + @  ",
		description: "Call Mom key:value:extra + @",
		projects: ["Work", "work", "Work"],
		contexts: ["Phone", "phone"],
		metadata: { key: "last" },
	});
	expect(file.items.slice(1, 7).map((item) => [item.completed, item.priority])).toEqual([
		[false, null],
		[false, null],
		[false, "A"],
		[false, null],
		[false, null],
		[false, null],
	]);
	expect(file.items[7]).toMatchObject({
		completed: true,
		completion_date: "2000-02-29",
		creation_date: "1999-01-01",
		priority: "A",
	});
	expect(file.skipped.map((line) => line.line_number)).toEqual([10, 11]);
	await rm(todoPath);
	const missing = await backend.restoreSession({});
	expect(missing.session).toMatchObject({
		status: "empty",
		warning: expect.stringContaining("Cannot open Todo file"),
		catalogue: { active_workspace_id: expect.any(String) },
	});
});
