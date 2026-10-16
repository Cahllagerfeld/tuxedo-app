import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend, type SessionDependencies } from "./session-runtime";

const directories: string[] = [];
const backends: ReturnType<typeof createSessionBackend>[] = [];
afterEach(async () => {
	await Promise.all(backends.splice(0).map((backend) => backend.dispose()));
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});

async function setup(contents: string, dependencies?: SessionDependencies) {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-bulk-completion-"));
	directories.push(directory);
	const path = join(directory, "todo.txt");
	await writeFile(path, contents);
	const backend = createSessionBackend(
		join(directory, "workspaces.json"),
		undefined,
		undefined,
		dependencies
	);
	backends.push(backend);
	const created = await backend.createWorkspace({
		name: "Personal",
		color: "blue",
		todoPath: path,
	});
	if (created.status !== "applied" || created.confirmed.session.status !== "ready")
		throw Error("setup failed");
	const session = created.confirmed;
	if (session.session.status !== "ready") throw Error("setup failed");
	return {
		backend,
		path,
		session,
		items: session.session.todo_file.items,
		target: {
			scope: session.scope,
			revision: session.revision,
			workspaceId: session.session.catalogue.active_workspace_id!,
		},
	};
}

test("bulk completion updates every selected open item atomically with one undo step", async () => {
	const initial = "(A) First\n(B) Second\nx 2026-01-01 Already done\n";
	const { backend, path, target, items } = await setup(initial, {
		identity: {
			uuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			now: () => new Date(2030, 0, 2).toISOString(),
		},
	});
	const result = await backend.bulkSetTodoCompletion({
		...target,
		targets: [
			{ lineNumber: items[0].line_number, expectedRaw: items[0].raw },
			{ lineNumber: items[1].line_number, expectedRaw: items[1].raw },
			{ lineNumber: items[2].line_number, expectedRaw: items[2].raw },
		],
	});
	expect(result.status).toBe("applied");
	if (result.status !== "applied") throw Error("bulk complete");
	expect(result.confirmed.todo_file.items.filter((item) => item.completed)).toHaveLength(3);
	expect(result.confirmed.undoLabel).toBe("Undo completion");
	const undone = await backend.undoTodo({
		scope: result.confirmed.scope,
		revision: result.confirmed.revision,
		workspaceId: result.confirmed.workspaceId,
	});
	expect(undone.status).toBe("applied");
	expect(await readFile(path, "utf8")).toBe(initial);
});

test("bulk completion rejects stale targets without writing", async () => {
	const { backend, path, target, items } = await setup("Open one\n");
	const item = items[0];
	const result = await backend.bulkSetTodoCompletion({
		...target,
		targets: [{ lineNumber: item.line_number, expectedRaw: "Stale" }],
	});
	expect(result.status).toBe("conflict");
	expect(await readFile(path, "utf8")).toBe("Open one\n");
});

test("bulk completion and undo preserve unrelated disk edits and exact line endings", async () => {
	const { backend, path, target, items } = await setup("(A) First\r\n\nx\nOther\nLast");
	const before = "(A) First\r\n\nx\nExternal edit\nLast";
	await writeFile(path, before);
	const result = await backend.bulkSetTodoCompletion({
		...target,
		targets: [items[0], items.at(-1)!].map((item) => ({
			lineNumber: item.line_number,
			expectedRaw: item.raw,
		})),
	});
	expect(result.status).toBe("applied");
	if (result.status !== "applied") throw Error("bulk complete");
	expect(await readFile(path, "utf8")).toMatch(
		/^x \d{4}-\d{2}-\d{2} First pri:A\r\n\nx\nExternal edit\nx \d{4}-\d{2}-\d{2} Last$/
	);
	const undone = await backend.undoTodo({ ...target, revision: result.confirmed.revision });
	expect(undone.status).toBe("applied");
	expect(await readFile(path, "utf8")).toBe(before);
});

test("a conflict in the last selected target writes nothing", async () => {
	const { backend, path, target, items } = await setup("First\nSecond\n");
	await writeFile(path, "First\nChanged\n");
	const result = await backend.bulkSetTodoCompletion({
		...target,
		targets: items.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
	});
	expect(result.status).toBe("conflict");
	expect(await readFile(path, "utf8")).toBe("First\nChanged\n");
});

test("a failed transformation rejects the whole batch with its actionable error", async () => {
	const contents = "(A) Conflicting pri:B\nSafe item\n";
	const { backend, path, target, items } = await setup(contents);
	const result = await backend.bulkSetTodoCompletion({
		...target,
		targets: items.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
	});
	expect(result).toEqual({
		status: "rejected",
		message: "Conflicting priority metadata; edit the Todo file before completing this item.",
	});
	expect(await readFile(path, "utf8")).toBe(contents);
});

test("empty, duplicate, malformed, and stale-session requests leave the file unchanged", async () => {
	const { backend, path, target } = await setup("First\n");
	const valid = { lineNumber: 1, expectedRaw: "First" };
	for (const request of [
		{ ...target, targets: [] },
		{ ...target, targets: [valid, valid] },
		{ ...target, targets: [{ ...valid, lineNumber: 0 }] },
		{ ...target, revision: target.revision + 1, targets: [valid] },
	]) {
		expect((await backend.bulkSetTodoCompletion(request)).status).toBe("rejected");
		expect(await readFile(path, "utf8")).toBe("First\n");
	}
});

test("a no-change batch retains the previous undo snapshot", async () => {
	const initial = "First\nx 2026-01-01 Done\n";
	const { backend, path, target, items } = await setup(initial);
	const completed = await backend.bulkSetTodoCompletion({
		...target,
		targets: [{ lineNumber: 1, expectedRaw: items[0].raw }],
	});
	if (completed.status !== "applied") throw Error("completion failed");
	const noChange = await backend.bulkSetTodoCompletion({
		...target,
		revision: completed.confirmed.revision,
		targets: [{ lineNumber: 2, expectedRaw: items[1].raw }],
	});
	expect(noChange.status).toBe("applied");
	if (noChange.status !== "applied") throw Error("no-change failed");
	expect(noChange.confirmed.undoLabel).toBe("Undo completion");
	const undone = await backend.undoTodo({ ...target, revision: noChange.confirmed.revision });
	expect(undone.status).toBe("applied");
	expect(await readFile(path, "utf8")).toBe(initial);
});
