import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, readFile, chmod, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend } from "./session";
const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});
async function setup(contents: string) {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-completion-"));
	directories.push(directory);
	const path = join(directory, "todo.txt");
	await writeFile(path, contents);
	const backend = createSessionBackend(join(directory, "workspaces.json"));
	const created = await backend.createWorkspace({
		name: "Personal",
		color: "blue",
		todoPath: path,
	});
	if (created.status !== "applied" || created.confirmed.session.status !== "ready")
		throw Error("setup failed");
	const session = created.confirmed;
	return {
		backend,
		path,
		directory,
		session,
		target: {
			scope: session.scope,
			revision: session.revision,
			workspaceId: created.confirmed.session.catalogue.active_workspace_id!,
			lineNumber: 1,
			expectedRaw: created.confirmed.session.todo_file.items[0].raw,
		},
	};
}
test("completion roundtrip retains exact raw priority, creation, spacing and mixed newlines", async () => {
	const initial = "  (A) 2026-05-24 Call Mom +Family @phone  \r\n\nOther\nFinal";
	const { backend, path, target } = await setup(initial);
	const applied = await backend.setTodoCompletion({ ...target, completed: true });
	expect(applied.status).toBe("applied");
	if (applied.status !== "applied") throw Error("completion failed");
	const now = new Date();
	const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	expect(await readFile(path, "utf8")).toBe(`x ${today} ${initial}`);
	expect(applied.confirmed.todo_file.items[0]).toMatchObject({
		completed: true,
		priority: "A",
		creation_date: "2026-05-24",
		completion_date: today,
	});
	const uncompleted = await backend.setTodoCompletion({
		...target,
		revision: applied.confirmed.revision,
		expectedRaw: applied.confirmed.todo_file.items[0].raw,
		completed: false,
	});
	expect(uncompleted.status).toBe("applied");
	expect(await readFile(path, "utf8")).toBe(initial);
});

test.each(["x Buy milk", "  x 2026-01-01 (B) 2025-12-31 Buy  milk  "])(
	"uncompletion removes only marker and completion date (%s)",
	async (raw) => {
		const { backend, path, target } = await setup(raw);
		const result = await backend.setTodoCompletion({ ...target, completed: false });
		expect(result.status).toBe("applied");
		expect(await readFile(path, "utf8")).toBe(
			raw === "x Buy milk" ? "Buy milk" : "  (B) 2025-12-31 Buy  milk  "
		);
	}
);
test("completion rereads disk preserving unrelated edits, blank and skipped lines", async () => {
	const { backend, path, target } = await setup("Buy milk\nSecond\n");
	await writeFile(path, "Buy milk\r\n\n+Only\nSecond changed");
	const result = await backend.setTodoCompletion({ ...target, completed: true });
	expect(result.status).toBe("applied");
	if (result.status !== "applied") throw Error("failed");
	expect(result.confirmed.todo_file.items[1]).toMatchObject({
		line_number: 4,
		description: "Second changed",
	});
	expect(result.confirmed.todo_file.skipped[0]).toMatchObject({ line_number: 3, raw: "+Only" });
	expect(await readFile(path, "utf8")).toMatch(
		/^x \d{4}-\d{2}-\d{2} Buy milk\r\n\n\+Only\nSecond changed$/
	);
});
test.each(["changed", "missing"])(
	"stale target (%s) confirms current disk without writing",
	async (kind) => {
		const { backend, path, target } = await setup("Buy milk\nSecond");
		const contents = kind === "changed" ? "Buy bread\nSecond" : "";
		await writeFile(path, contents);
		const result = await backend.setTodoCompletion({ ...target, completed: true });
		expect(result.status).toBe("conflict");
		expect(await readFile(path, "utf8")).toBe(contents);
		if (result.status !== "conflict") throw Error("No conflict");
		expect((await backend.readSession({})).revision).toBe(result.confirmed.revision);
	}
);
test.each([
	"same-state",
	"wrong-scope",
	"wrong-revision",
	"wrong-workspace",
	"invalid-target",
	"write-failure",
])("rejected completion (%s) preserves bytes and confirmed snapshot", async (kind) => {
	const { backend, path, directory, target, session } = await setup("Buy milk\n");
	if (kind === "write-failure") await chmod(directory, 0o500);
	const result = await backend.setTodoCompletion({
		...target,
		completed: kind !== "same-state",
		...(kind === "wrong-scope"
			? { scope: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
			: kind === "wrong-workspace"
				? { workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
				: kind === "wrong-revision"
					? { revision: 999 }
					: kind === "invalid-target"
						? { expectedRaw: "+Only" }
						: {}),
	});
	if (kind === "write-failure") await chmod(directory, 0o700);
	expect(result.status).toBe("rejected");
	expect(await readFile(path, "utf8")).toBe("Buy milk\n");
	expect(await backend.readSession({})).toEqual(session);
	expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
});
test("serialized duplicate intents cannot apply twice", async () => {
	const { backend, path, target } = await setup("Buy milk");
	const results = await Promise.all([
		backend.setTodoCompletion({ ...target, completed: true }),
		backend.setTodoCompletion({ ...target, completed: true }),
	]);
	expect(results.map((result) => result.status)).toEqual(["applied", "rejected"]);
	expect(await readFile(path, "utf8")).toMatch(/^x \d{4}-\d{2}-\d{2} Buy milk$/);
});

test("a lone carriage return remains raw Todo-item content rather than a line separator", async () => {
	const { backend, path, target } = await setup("Buy\rmilk\nSecond");
	const result = await backend.setTodoCompletion({ ...target, completed: true });
	expect(result.status).toBe("applied");
	expect(await readFile(path, "utf8")).toMatch(/^x \d{4}-\d{2}-\d{2} Buy\rmilk\nSecond$/);
});

test("uncompletion consumes a tab after the Completion date", async () => {
	const { backend, path, target } = await setup("x 2020-01-01\tBuy milk\r\nSecond");
	const result = await backend.setTodoCompletion({ ...target, completed: false });
	expect(result.status).toBe("applied");
	expect(await readFile(path)).toEqual(Buffer.from("Buy milk\r\nSecond"));
	if (result.status !== "applied") throw Error("uncompletion failed");
	expect(result.confirmed.todo_file.items[0]).toMatchObject({
		creation_date: null,
		completion_date: null,
		description: "Buy milk",
	});
});

test("editing a later Todo item preserves the first line UTF-8 BOM bytes", async () => {
	const initial = "\uFEFF(A) Buy milk\r\nx 2020-01-01 Second\n";
	const { backend, path, target } = await setup(initial);
	const result = await backend.setTodoCompletion({
		...target,
		lineNumber: 2,
		expectedRaw: "x 2020-01-01 Second",
		completed: false,
	});
	expect(result.status).toBe("applied");
	expect(await readFile(path)).toEqual(Buffer.from("\uFEFF(A) Buy milk\r\nSecond\n"));
	if (result.status !== "applied") throw Error("uncompletion failed");
	expect(result.confirmed.todo_file.items[0]).toMatchObject({
		raw: "\uFEFF(A) Buy milk",
		priority: null,
		description: "\uFEFF(A) Buy milk",
	});
});
