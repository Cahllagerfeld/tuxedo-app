import { activateWorkspace, readConfirmation } from "./testing/read-confirmation";
import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend } from "../session-runtime";

const directories: string[] = [];
const backends: ReturnType<typeof createSessionBackend>[] = [];
afterEach(async () => {
	await Promise.all(backends.splice(0).map((backend) => backend.dispose()));
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});
async function setup(contents: string) {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-bulk-deletion-"));
	directories.push(directory);
	const path = join(directory, "todo.txt");
	await writeFile(path, contents.replace("2026-13-01 Invalid", "Valid"));
	const backend = createSessionBackend(join(directory, "workspaces.json"));
	backends.push(backend);
	const created = await backend.createWorkspace({
		name: "Personal",
		color: "blue",
		todoPath: path,
	});
	if (created.status !== "applied" || created.confirmed.session.status !== "ready")
		throw Error("setup failed");
	await writeFile(path, contents);
	const confirmed = await activateWorkspace(
		backend,
		created.confirmed.session.catalogue.active_workspace_id!
	);
	if (confirmed.session.status !== "ready") throw Error("restoration failed");
	const target = {
		scope: confirmed.scope,
		revision: confirmed.revision,
		workspaceId: confirmed.session.catalogue.active_workspace_id!,
	};
	const targets = confirmed.session.todo_file.items.map((item) => ({
		lineNumber: item.line_number,
		expectedRaw: item.raw,
	}));
	return { backend, path, target, targets };
}

test("bulk deletion removes only selected physical lines and one Undo restores exact disk bytes", async () => {
	const initial =
		"(A) 2026-01-01 First  +Work\r\n\n2026-13-01 Invalid\nHidden\r\nx 2026-01-02 2026-01-01 Finished due:2026-01-03\nLast";
	const { backend, path, target, targets } = await setup(initial);
	const before = initial.replace("Hidden", "Unrelated external edit");
	await writeFile(path, before);
	const result = await backend.bulkDeleteTodos({
		...target,
		// Deliberately unsorted, including the unterminated final line.
		targets: [targets.at(-1)!, targets[0], targets[2]],
	});
	expect(result.status).toBe("applied");
	if (result.status !== "applied") throw Error("deletion failed");
	expect(await readFile(path, "utf8")).toBe("\n2026-13-01 Invalid\nUnrelated external edit\r\n");
	expect(result.confirmed.todo_file.items.map((item) => item.raw)).toEqual([
		"Unrelated external edit",
	]);
	expect(result.confirmed.todo_file.skipped).toHaveLength(1);
	expect(result.confirmed.undoLabel).toBe("Undo deletion");
	const undone = await backend.undoTodo({ ...target, revision: result.confirmed.revision });
	expect(undone.status).toBe("applied");
	expect(await readFile(path, "utf8")).toBe(before);
	if (undone.status !== "applied") throw Error("undo failed");
	expect(undone.confirmed.undoLabel).toBeUndefined();
	expect((await backend.undoTodo({ ...target, revision: undone.confirmed.revision })).status).toBe(
		"rejected"
	);
});

test("bulk deletion accepts lone CR and BOM content, preserves untouched CR content, and Undo restores exact bytes", async () => {
	const initial = "Delete\rthis\r\nKeep\rthat\n\uFEFF\nx 2026-01-01 Done\rcontent\r";
	const { backend, path, target, targets } = await setup(initial);
	expect(targets.map((item) => item.expectedRaw)).toEqual([
		"Delete\rthis",
		"Keep\rthat",
		"\uFEFF",
		"x 2026-01-01 Done\rcontent\r",
	]);
	const result = await backend.bulkDeleteTodos({
		...target,
		targets: [targets[3], targets[0], targets[2]],
	});
	expect(result.status).toBe("applied");
	if (result.status !== "applied") throw Error(result.message);
	expect(await readFile(path)).toEqual(Buffer.from("Keep\rthat\n"));
	expect(result.confirmed.todo_file.items.map((item) => item.raw)).toEqual(["Keep\rthat"]);
	const undone = await backend.undoTodo({ ...target, revision: result.confirmed.revision });
	expect(undone.status).toBe("applied");
	expect(await readFile(path)).toEqual(Buffer.from(initial));
});

test("deleting every Todo item leaves an empty file and can be undone in one step", async () => {
	const initial = "First\r\nx 2026-01-01 Done";
	const { backend, path, target, targets } = await setup(initial);
	const result = await backend.bulkDeleteTodos({ ...target, targets });
	if (result.status !== "applied") throw Error("deletion failed");
	expect(await readFile(path, "utf8")).toBe("");
	expect(result.confirmed.todo_file.items).toEqual([]);
	expect((await backend.undoTodo({ ...target, revision: result.confirmed.revision })).status).toBe(
		"applied"
	);
	expect(await readFile(path, "utf8")).toBe(initial);
});

test.each(["changed", "missing", "shifted"])(
	"a %s target conflicts before any deletion and refreshes confirmed data",
	async (kind) => {
		const { backend, path, target, targets } = await setup("First\nSecond\n");
		const changed =
			kind === "changed"
				? "First\nChanged\n"
				: kind === "missing"
					? "First\n"
					: "Inserted\nFirst\nSecond\n";
		await writeFile(path, changed);
		const result = await backend.bulkDeleteTodos({ ...target, targets });
		expect(result.status).toBe("conflict");
		expect(await readFile(path, "utf8")).toBe(changed);
		if (result.status !== "conflict") throw Error("expected conflict");
		expect(result.confirmed.todo_file.items.map((item) => item.raw)).toEqual(
			changed.trim().split("\n")
		);
		const confirmed = await readConfirmation(backend);
		expect(confirmed.revision).toBe(result.confirmed.revision);
		expect(confirmed.undoLabel).toBeUndefined();
	}
);

test("invalid, duplicate, empty and stale-session batches write nothing and preserve the previous undo slot", async () => {
	const initial = "First\nSecond\n";
	const { backend, path, target, targets } = await setup(initial);
	const completed = await backend.setTodoCompletion({ ...target, ...targets[0], completed: true });
	if (completed.status !== "applied") throw Error("completion failed");
	const current = { ...target, revision: completed.confirmed.revision };
	const valid = targets[1];
	const before = await readFile(path, "utf8");
	const confirmed = await readConfirmation(backend);
	for (const request of [
		{ ...current, targets: [] },
		{ ...current, targets: [valid, valid] },
		...[-1, 0, 1.5].map((lineNumber) => ({ ...current, targets: [{ ...valid, lineNumber }] })),
		...["", " ", "\r", "\u0085", " \u2003\r", "First\nSecond", "2026-13-01 Invalid"].map(
			(expectedRaw) => ({
				...current,
				targets: [{ ...valid, expectedRaw }],
			})
		),
		{ ...current, targets: [valid], extra: true },
		{ ...current, targets: [{ ...valid, extra: true }] },
		{ ...current, targets: [valid], scope: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
		{ ...current, targets: [valid], workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
		{ ...target, targets: [valid] },
	]) {
		expect((await backend.bulkDeleteTodos(request)).status).toBe("rejected");
		expect(await readFile(path, "utf8")).toBe(before);
		expect(await readConfirmation(backend)).toEqual(confirmed);
	}
	expect((await backend.undoTodo(current)).status).toBe("applied");
	expect(await readFile(path, "utf8")).toBe(initial);
});
