import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend } from "./session-runtime";
import type { ConfirmedTodo } from "../../src/lib/shared/desktop/contract";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(contents = "(A) 2026-01-01 First +Work\r\n\nLast") {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-undo-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	const todoPath = join(directory, "todo.txt");
	await writeFile(todoPath, contents);
	const backend = createSessionBackend(join(directory, "workspaces.json"));
	cleanups.push(() => backend.dispose());
	const created = await backend.createWorkspace({ name: "Work", color: "blue", todoPath });
	if (created.status !== "applied" || created.confirmed.session.status !== "ready")
		throw Error("Setup failed");
	const target = {
		scope: created.confirmed.scope,
		revision: created.confirmed.revision,
		workspaceId: created.confirmed.session.catalogue.active_workspace_id!,
	};
	return { backend, todoPath, target, contents };
}

function targetOf(confirmed: ConfirmedTodo) {
	return {
		scope: confirmed.scope,
		revision: confirmed.revision,
		workspaceId: confirmed.workspaceId,
	};
}

test("Undo restores a deletion exactly and consumes its single slot", async () => {
	const { backend, todoPath, target, contents } = await setup();
	const deleted = await backend.deleteTodo({
		...target,
		lineNumber: 1,
		expectedRaw: contents.split("\r\n")[0],
	});
	if (deleted.status !== "applied") throw Error("Deletion failed");
	expect(deleted.confirmed.undoLabel).toBe("Undo deletion");
	const undone = await backend.undoTodo(targetOf(deleted.confirmed));
	expect(undone.status).toBe("applied");
	if (undone.status !== "applied") throw Error("Undo failed");
	expect(await readFile(todoPath, "utf8")).toBe(contents);
	expect(undone.confirmed.undoLabel).toBeUndefined();
	expect((await backend.undoTodo(targetOf(undone.confirmed))).status).toBe("rejected");
});

test.each(["create", "edit", "complete", "uncomplete", "reorder"] as const)(
	"Undo restores %s, including dates, metadata, whitespace, and line endings",
	async (operation) => {
		const initial =
			operation === "uncomplete"
				? "x 2026-10-01 2026-01-01 First +Work pri:A  \r\n\nLast"
				: "(A) 2026-01-01 First +Work custom:keep  \r\n\nLast";
		const { backend, target, todoPath } = await setup(initial);
		const itemTarget = { ...target, lineNumber: 1, expectedRaw: initial.split("\r\n")[0] };
		const changed = await (operation === "create"
			? backend.createTodo({ ...target, description: "New", projects: [], contexts: [] })
			: operation === "edit"
				? backend.editTodo({
						...itemTarget,
						description: "Edited",
						projects: [],
						contexts: [],
						creationDate: null,
						completed: false,
					})
				: operation === "reorder"
					? backend.reorderTodo({ ...target, lineNumbers: [3, 1] })
					: backend.setTodoCompletion({ ...itemTarget, completed: operation === "complete" }));
		if (changed.status !== "applied") throw Error("Change failed");
		expect(await readFile(todoPath, "utf8")).not.toBe(initial);
		expect((await backend.undoTodo(targetOf(changed.confirmed))).status).toBe("applied");
		expect(await readFile(todoPath, "utf8")).toBe(initial);
	}
);

test("only the most recent change is available; rejected and unchanged operations keep it", async () => {
	const { backend, target, todoPath, contents } = await setup();
	const created = await backend.createTodo({
		...target,
		description: "New",
		projects: [],
		contexts: [],
		creationDate: null,
	});
	if (created.status !== "applied") throw Error("Creation failed");
	const beforeDeletion = await readFile(todoPath, "utf8");
	const deleted = await backend.deleteTodo({
		...targetOf(created.confirmed),
		lineNumber: 1,
		expectedRaw: contents.split("\r\n")[0],
	});
	if (deleted.status !== "applied") throw Error("Deletion failed");
	expect((await backend.deleteTodo({ ...target, lineNumber: 1, expectedRaw: "Old" })).status).toBe(
		"rejected"
	);
	const unchanged = await backend.reorderTodo({
		...targetOf(deleted.confirmed),
		lineNumbers: deleted.confirmed.todo_file.items.map((item) => item.line_number),
	});
	if (unchanged.status !== "applied") throw Error("Reorder failed");
	expect(unchanged.confirmed.undoLabel).toBe("Undo deletion");
	const undone = await backend.undoTodo(targetOf(unchanged.confirmed));
	if (undone.status !== "applied") throw Error("Undo failed");
	expect(await readFile(todoPath, "utf8")).toBe(beforeDeletion);
	expect((await backend.undoTodo(targetOf(undone.confirmed))).status).toBe("rejected");
});

test("Undo refuses unseen external edits and returns their confirmed contents", async () => {
	const { backend, target, todoPath } = await setup();
	const created = await backend.createTodo({
		...target,
		description: "New",
		projects: [],
		contexts: [],
	});
	if (created.status !== "applied") throw Error("Creation failed");
	await writeFile(todoPath, "External\r\n\n");
	const result = await backend.undoTodo(targetOf(created.confirmed));
	expect(result).toMatchObject({
		status: "conflict",
		confirmed: { todo_file: { items: [{ description: "External" }] } },
	});
	if (result.status !== "conflict") throw Error("Expected conflict");
	expect(result.confirmed.undoLabel).toBeUndefined();
	expect(await readFile(todoPath, "utf8")).toBe("External\r\n\n");
	expect((await backend.undoTodo(targetOf(result.confirmed))).status).toBe("rejected");
});

test("Undo preserves unrelated external edits incorporated by the last mutation", async () => {
	const { backend, target, todoPath, contents } = await setup();
	const external = contents.replace("Last", "Externally edited");
	await writeFile(todoPath, external);
	const deleted = await backend.deleteTodo({
		...target,
		lineNumber: 1,
		expectedRaw: contents.split("\r\n")[0],
	});
	if (deleted.status !== "applied") throw Error("Deletion failed");
	expect((await backend.undoTodo(targetOf(deleted.confirmed))).status).toBe("applied");
	expect(await readFile(todoPath, "utf8")).toBe(external);
});

test("refresh preserves Undo for unchanged contents and clears it after an external edit", async () => {
	const { backend, target, todoPath } = await setup();
	const created = await backend.createTodo({
		...target,
		description: "New",
		projects: [],
		contexts: [],
	});
	if (created.status !== "applied") throw Error("Creation failed");
	expect((await backend.restoreSession({})).undoLabel).toBe("Undo creation");
	await writeFile(todoPath, "External");
	expect((await backend.restoreSession({})).undoLabel).toBeUndefined();
});

test("Workspace switching and restarting clear Undo; a failed switch keeps it", async () => {
	const { backend, target, todoPath } = await setup();
	const created = await backend.createTodo({
		...target,
		description: "New",
		projects: [],
		contexts: [],
	});
	if (created.status !== "applied") throw Error("Creation failed");
	expect(
		(await backend.switchWorkspace({ workspaceId: "00000000-0000-4000-8000-000000000000" })).status
	).toBe("rejected");
	expect((await backend.readSession({})).undoLabel).toBe("Undo creation");
	const restarted = createSessionBackend(join(todoPath, "..", "workspaces.json"));
	cleanups.push(() => restarted.dispose());
	expect((await restarted.restoreSession({})).undoLabel).toBeUndefined();
	const switched = await backend.switchWorkspace({ workspaceId: target.workspaceId });
	if (switched.status !== "applied") throw Error("Switch failed");
	expect(switched.confirmed.undoLabel).toBeUndefined();
	expect(
		(await backend.undoTodo({ ...target, revision: switched.confirmed.revision })).status
	).toBe("rejected");
});
