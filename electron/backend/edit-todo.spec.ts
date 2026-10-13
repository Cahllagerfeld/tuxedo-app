import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend } from "./session-runtime";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});
async function setup() {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-edit-"));
	directories.push(directory);
	const todoPath = join(directory, "todo.txt");
	await writeFile(
		todoPath,
		"Keep\r\nx 2026-10-09 2026-10-01 Old +Work custom:first custom:last\r\nLast"
	);
	const backend = createSessionBackend(join(directory, "workspaces.json"));
	const created = await backend.createWorkspace({ name: "Work", color: "blue", todoPath });
	if (created.status !== "applied" || created.confirmed.session.status !== "ready")
		throw Error("setup");
	const request = {
		scope: created.confirmed.scope,
		revision: created.confirmed.revision,
		workspaceId: created.confirmed.session.catalogue.active_workspace_id!,
		lineNumber: 2,
		expectedRaw: created.confirmed.session.todo_file.items[1].raw,
		description: "Updated",
		projects: ["Home"],
		contexts: ["desk"],
		creationDate: "2026-10-01",
		completed: true,
		completionDate: "2026-10-09",
		metadata: ["custom:first", "custom:last"],
	};
	return { backend, todoPath, request };
}
test("editing replaces only the targeted line and preserves dates, metadata, endings and position", async () => {
	const { backend, todoPath, request } = await setup();
	const outcome = await backend.editTodo(request);
	expect(outcome.status).toBe("applied");
	expect(await readFile(todoPath, "utf8")).toBe(
		"Keep\r\nx 2026-10-09 2026-10-01 Updated +Home @desk custom:first custom:last\r\nLast"
	);
	if (outcome.status !== "applied") throw Error(outcome.message);
	expect(outcome.confirmed.todo_file.items[1]).toMatchObject({
		description: "Updated",
		completed: true,
		creation_date: "2026-10-01",
		completion_date: "2026-10-09",
		metadata: { custom: "last" },
	});
});

test("a changed target returns a conflict without overwriting disk", async () => {
	const { backend, todoPath, request } = await setup();
	const contents = "Keep\r\nChanged externally\r\nLast";
	await writeFile(todoPath, contents);
	const outcome = await backend.editTodo(request);
	expect(outcome.status).toBe("conflict");
	expect(await readFile(todoPath, "utf8")).toBe(contents);
	if (outcome.status !== "conflict") throw Error("Expected conflict");
	expect(outcome.confirmed.todo_file.items[1].description).toBe("Changed externally");
});
test("editing cannot clear an existing Completion date", async () => {
	const { backend, todoPath, request } = await setup();
	const raw = "x 2026-10-09 Old";
	await writeFile(todoPath, raw);
	const restored = await backend.restoreSession({});
	const outcome = await backend.editTodo({
		...request,
		revision: restored.revision,
		lineNumber: 1,
		expectedRaw: raw,
		creationDate: null,
		completionDate: null,
	});
	expect(outcome.status).toBe("rejected");
	expect(await readFile(todoPath, "utf8")).toBe(raw);
	expect(await backend.readSession({})).toEqual(restored);
});
test("invalid edits and stale session targets preserve disk and confirmed data", async () => {
	const { backend, todoPath, request } = await setup();
	const before = await readFile(todoPath, "utf8");
	const confirmed = await backend.readSession({});
	for (const input of [
		{ ...request, description: "Wrong +token" },
		{ ...request, revision: request.revision + 1 },
	]) {
		expect((await backend.editTodo(input)).status).toBe("rejected");
		expect(await readFile(todoPath, "utf8")).toBe(before);
		expect(await backend.readSession({})).toEqual(confirmed);
	}
});

test("editing legacy completed items keeps their completion state without inventing dates", async () => {
	const { backend, todoPath, request } = await setup();
	await writeFile(todoPath, "x +Work custom:first custom:last");
	const restored = await backend.restoreSession({});
	if (restored.session.status !== "ready") throw Error("setup");
	expect(restored.session.todo_file.items[0].edit).toEqual({
		description: "",
		metadata: ["custom:first", "custom:last"],
	});
	const outcome = await backend.editTodo({
		...request,
		revision: restored.revision,
		lineNumber: 1,
		expectedRaw: "x +Work custom:first custom:last",
		description: "",
		projects: [],
		contexts: [],
		metadata: [],
		creationDate: null,
		completionDate: null,
	});
	expect(outcome.status).toBe("applied");
	if (outcome.status !== "applied") throw Error(outcome.message);
	expect(await readFile(todoPath, "utf8")).toBe("x ");
	expect(outcome.confirmed.todo_file.items[0].completed).toBe(true);
});

test.each([
	["x (A) 2026-10-01 Old", "x (A) 2026-10-01 Updated", null, "2026-10-01", [], "Updated"],
	[
		"x 2026-10-09 (A) Old pri:B",
		"x 2026-10-09 (A) Updated pri:B",
		"2026-10-09",
		null,
		["pri:B"],
		"Updated",
	],
	[
		"x 2026-10-09 (A) (B) Old",
		"x 2026-10-09 (A) (B) Updated",
		"2026-10-09",
		null,
		[],
		"(B) Updated",
	],
] as const)(
	"editing retains legacy completed Priority and dates (%s)",
	async (raw, expected, completionDate, creationDate, metadata, description) => {
		const { backend, todoPath, request } = await setup();
		await writeFile(todoPath, raw);
		const restored = await backend.restoreSession({});
		const outcome = await backend.editTodo({
			...request,
			revision: restored.revision,
			lineNumber: 1,
			expectedRaw: raw,
			description,
			priority: "A",
			completionDate,
			creationDate,
			projects: [],
			contexts: [],
			metadata: [...metadata],
		});
		expect(outcome.status).toBe("applied");
		expect(await readFile(todoPath, "utf8")).toBe(expected);
	}
);
