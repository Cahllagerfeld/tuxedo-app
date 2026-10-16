import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend, type SessionDependencies } from "./session-runtime";

const directories: string[] = [];
afterEach(async () => {
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
