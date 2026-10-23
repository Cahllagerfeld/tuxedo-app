import { readConfirmation } from "./testing/read-confirmation";
import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, readFile, chmod, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend, type SessionDependencies } from "../session-runtime";

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
		directory,
		session,
		items: session.session.todo_file.items,
		target: {
			scope: session.scope,
			revision: session.revision,
			workspaceId: session.session.catalogue.active_workspace_id!,
		},
	};
}

test("bulk uncompletion preserves dates, Priority, mixed selection, unrelated edits and whole-batch undo", async () => {
	const initial =
		"x 2026-10-16 2026-01-02 First pri:A\r\n\nx\nOpen pri:Z\nx (B) Legacy\nOther\nx 2026-10-16 Last";
	const { backend, path, target, items } = await setup(initial);
	const before = initial.replace("Other", "External edit");
	await writeFile(path, before);
	const selected = items.filter((item) => item.description !== "Other");
	const result = await backend.bulkSetTodoCompletion({
		...target,
		completed: false,
		targets: selected.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
	});
	expect(result.status).toBe("applied");
	if (result.status !== "applied") throw Error("bulk uncomplete");
	expect(result.confirmed.undoLabel).toBe("Undo uncompletion");
	expect(await readFile(path, "utf8")).toBe(
		"(A) 2026-01-02 First\r\n\nx\nOpen pri:Z\n(B) Legacy\nExternal edit\nLast"
	);
	const undone = await backend.undoTodo({ ...target, revision: result.confirmed.revision });
	expect(undone.status).toBe("applied");
	expect(await readFile(path, "utf8")).toBe(before);
});

test.each([
	["x 2026-10-16 Conflicting pri:A pri:B", "Conflicting priority metadata"],
	["x 2026-10-16 ", "without remaining content"],
])(
	"bulk uncompletion rejects invalid transformation %s without partial writes",
	async (invalid, message) => {
		const contents = `${invalid}\nx 2026-10-16 Safe item\n`;
		const { backend, path, target, items } = await setup(contents);
		const result = await backend.bulkSetTodoCompletion({
			...target,
			completed: false,
			targets: items.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
		});
		expect(result.status).toBe("rejected");
		if (result.status !== "rejected") throw Error("expected rejection");
		expect(result.message).toContain(message);
		expect(await readFile(path, "utf8")).toBe(contents);
	}
);

test.each(["x 2026-10-16 Done", "Open"])(
	"bulk uncompletion validates even unchanged selected target %s",
	async (last) => {
		const { backend, path, target, items } = await setup(`x 2026-10-16 First\n${last}\n`);
		const before = "x 2026-10-16 First\nChanged externally\n";
		await writeFile(path, before);
		const result = await backend.bulkSetTodoCompletion({
			...target,
			completed: false,
			targets: items.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
		});
		expect(result.status).toBe("conflict");
		if (result.status !== "conflict") throw Error("expected conflict");
		expect(result.confirmed.todo_file.items[1].raw).toBe("Changed externally");
		expect(await readFile(path, "utf8")).toBe(before);
	}
);

test("a failed bulk uncompletion write preserves disk and confirmed data and permits retry", async () => {
	const initial = "x 2026-10-16 First\r\nx Legacy";
	const { backend, path, directory, target, items, session } = await setup(initial);
	const request = {
		...target,
		completed: false,
		targets: items.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
	};
	await chmod(directory, 0o500);
	try {
		expect((await backend.bulkSetTodoCompletion(request)).status).toBe("rejected");
		expect(await readFile(path, "utf8")).toBe(initial);
		expect(await readConfirmation(backend)).toEqual(session);
		expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
	} finally {
		await chmod(directory, 0o700);
	}
	expect((await backend.bulkSetTodoCompletion(request)).status).toBe("applied");
	expect(await readFile(path, "utf8")).toBe("First\r\nLegacy");
});

test("bulk completion updates every selected open item atomically with one undo step", async () => {
	const initial = "(A) First\n(B) Second\nx 2026-01-01 Already done\n";
	const { backend, path, target, items } = await setup(initial, {
		identity: {
			uuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			now: () => new Date(2030, 0, 2).toISOString(),
		},
	});
	const result = await backend.bulkSetTodoCompletion({
		completed: true,
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
		completed: true,
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
		completed: true,
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
		completed: true,
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
		completed: true,
		...target,
		targets: items.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
	});
	expect(result).toEqual({
		status: "rejected",
		message: "Conflicting priority metadata; edit the Todo file before completing this item.",
	});
	expect(await readFile(path, "utf8")).toBe(contents);
});

test.each([true, false])(
	"empty, duplicate, malformed, and stale-session completion=%s requests leave the file unchanged",
	async (completed) => {
		const { backend, path, target } = await setup("First\n");
		const valid = { lineNumber: 1, expectedRaw: "First" };
		for (const request of [
			{ ...target, targets: [] },
			{ ...target, targets: [valid, valid] },
			{ ...target, targets: [{ ...valid, lineNumber: 0 }] },
			{ ...target, revision: target.revision + 1, targets: [valid] },
		]) {
			expect((await backend.bulkSetTodoCompletion({ ...request, completed })).status).toBe(
				"rejected"
			);
			expect(await readFile(path, "utf8")).toBe("First\n");
		}
	}
);

test.each([true, false])(
	"a no-change completion=%s batch retains the previous undo snapshot",
	async (completedState) => {
		const initial = "First\nx 2026-01-01 Done\nOpen\n";
		const { backend, path, target, items } = await setup(initial);
		const completed = await backend.bulkSetTodoCompletion({
			completed: true,
			...target,
			targets: [{ lineNumber: 1, expectedRaw: items[0].raw }],
		});
		if (completed.status !== "applied") throw Error("completion failed");
		const unchanged = items[completedState ? 1 : 2];
		const noChange = await backend.bulkSetTodoCompletion({
			completed: completedState,
			...target,
			revision: completed.confirmed.revision,
			targets: [{ lineNumber: unchanged.line_number, expectedRaw: unchanged.raw }],
		});
		expect(noChange.status).toBe("applied");
		if (noChange.status !== "applied") throw Error("no-change failed");
		expect(noChange.confirmed.undoLabel).toBe("Undo completion");
		const undone = await backend.undoTodo({ ...target, revision: noChange.confirmed.revision });
		expect(undone.status).toBe("applied");
		expect(await readFile(path, "utf8")).toBe(initial);
	}
);

test("bulk recurring completion reports mixed results, inserts beside each original, and undoes exact bytes", async () => {
	const initial =
		"(A) Monthly +Home rec:1m due:2028-01-31 t:2028-01-29\r\n\nOrdinary\nWeekly rec:1w\nx 2020-01-01 Already rec:1d\nMarked rec:1d tuxedo-generated:1\nUnsupported rec:+1w\nAlso unsupported rec:0d\nUnselected rec:1d\nYearly rec:1y";
	const { backend, path, target, items } = await setup(initial, {
		identity: {
			uuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			now: () => new Date(2028, 0, 31, 12).toISOString(),
		},
	});
	const before = initial.replace("Unselected", "External edit");
	await writeFile(path, before);
	const result = await backend.bulkSetTodoCompletion({
		...target,
		completed: true,
		targets: items
			.filter((item) => item.description !== "Unselected")
			.reverse()
			.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
	});
	expect(result.status).toBe("applied");
	if (result.status !== "applied") throw Error("bulk completion failed");
	expect(result.notice).toBe("Generated 3 next occurrences. Skipped 2 unsupported Repeat rules.");
	expect(await readFile(path, "utf8")).toBe(
		"x 2028-01-31 Monthly +Home rec:1m due:2028-01-31 t:2028-01-29 pri:A tuxedo-generated:1\r\n(A) 2028-01-31 Monthly +Home rec:1m t:2028-02-27 due:2028-02-29\r\n\nx 2028-01-31 Ordinary\nx 2028-01-31 Weekly rec:1w tuxedo-generated:1\n2028-01-31 Weekly rec:1w due:2028-02-07\nx 2020-01-01 Already rec:1d\nx 2028-01-31 Marked rec:1d tuxedo-generated:1\nx 2028-01-31 Unsupported rec:+1w\nx 2028-01-31 Also unsupported rec:0d\nExternal edit rec:1d\nx 2028-01-31 Yearly rec:1y tuxedo-generated:1\r\n2028-01-31 Yearly rec:1y due:2029-01-31"
	);
	expect(result.confirmed.todo_file.items.filter((item) => item.completed)).toHaveLength(8);
	const undone = await backend.undoTodo({ ...target, revision: result.confirmed.revision });
	expect(undone.status).toBe("applied");
	expect(await readFile(path, "utf8")).toBe(before);
});

test.each([
	["Overflow rec:99999y", "supported date range"],
	["Threshold rec:1d due:0001-01-01 t:9999-12-31", "Show from date"],
	["(A) Conflicting rec:1d pri:B", "Conflicting priority"],
])(
	"bulk recurrence rejects %s without partially completing other targets",
	async (invalid, message) => {
		const initial = `Safe rec:1w\n${invalid}\nOrdinary`;
		const { backend, path, target, items, session } = await setup(initial);
		const result = await backend.bulkSetTodoCompletion({
			...target,
			completed: true,
			targets: items.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
		});
		expect(result).toMatchObject({ status: "rejected", message: expect.stringContaining(message) });
		expect(await readFile(path, "utf8")).toBe(initial);
		expect(await readConfirmation(backend)).toEqual(session);
	}
);

test("a recurring batch write failure leaves no completions, markers, successors or temporary files", async () => {
	const initial = "First rec:1w\r\nLast rec:1m";
	const { backend, path, directory, target, items, session } = await setup(initial);
	await chmod(directory, 0o500);
	try {
		const result = await backend.bulkSetTodoCompletion({
			...target,
			completed: true,
			targets: items.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
		});
		expect(result.status).toBe("rejected");
		expect(await readFile(path, "utf8")).toBe(initial);
		expect(await readConfirmation(backend)).toEqual(session);
		expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
	} finally {
		await chmod(directory, 0o700);
	}
});

test("bulk uncompletion and reopening preserve generation markers and never duplicate successors", async () => {
	const { backend, path, target, items } = await setup("First rec:1w\nLast rec:1m");
	const completed = await backend.bulkSetTodoCompletion({
		...target,
		completed: true,
		targets: items.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
	});
	if (completed.status !== "applied") throw Error("completion failed");
	expect(completed.notice).toBe("Generated 2 next occurrences.");
	const before = await readFile(path, "utf8");
	const reopened = await backend.bulkSetTodoCompletion({
		...target,
		revision: completed.confirmed.revision,
		completed: false,
		targets: completed.confirmed.todo_file.items
			.filter((item) => item.completed)
			.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
	});
	if (reopened.status !== "applied") throw Error("uncompletion failed");
	const originals = reopened.confirmed.todo_file.items.filter(
		(item) => item.metadata["tuxedo-generated"]
	);
	expect(originals).toHaveLength(2);
	const restored = await readConfirmation(backend);
	const recompleted = await backend.bulkSetTodoCompletion({
		...target,
		revision: restored.revision,
		completed: true,
		targets: originals.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
	});
	expect(recompleted.status).toBe("applied");
	expect(await readFile(path, "utf8")).toBe(before);
});

test("unsupported-only batches report a skip rather than a generation failure", async () => {
	const { backend, path, target, items } = await setup("Legacy rec:+1w");
	const result = await backend.bulkSetTodoCompletion({
		...target,
		completed: true,
		targets: items.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
	});
	expect(result).toMatchObject({
		status: "applied",
		notice: "Generated 0 next occurrences. Skipped 1 unsupported Repeat rule.",
	});
	expect(await readFile(path, "utf8")).toMatch(/^x \d{4}-\d{2}-\d{2} Legacy rec:\+1w$/);
});
