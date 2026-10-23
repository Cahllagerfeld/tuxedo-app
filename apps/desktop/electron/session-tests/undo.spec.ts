import { Effect } from "effect";
import type { TodoFileObservationAdapter } from "../observation";
import type { TodoFileChange } from "@tuxedo/contracts";
import { activateWorkspace, readConfirmation } from "./testing/read-confirmation";
import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend } from "../session-runtime";
import type { ConfirmedTodo } from "@tuxedo/contracts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(
	contents = "(A) 2026-01-01 First +Work\r\n\nLast",
	observation?: TodoFileObservationAdapter,
	changed?: (event: TodoFileChange) => void
) {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-undo-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	const todoPath = join(directory, "todo.txt");
	await writeFile(todoPath, contents);
	const backend = createSessionBackend(join(directory, "workspaces.json"), observation, changed);
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

test("repeatable reads preserve Undo and authoritative observation clears it after an external edit", async () => {
	let signal!: () => void;
	let received!: () => void;
	const observed = new Promise<void>((resolve) => {
		received = resolve;
	});
	const { backend, target, todoPath } = await setup(
		undefined,
		{
			observe: (_path, changed) =>
				Effect.sync(() => {
					signal = changed;
				}),
		},
		() => received()
	);
	const created = await backend.createTodo({
		...target,
		description: "New",
		projects: [],
		contexts: [],
	});
	if (created.status !== "applied") throw Error("Creation failed");
	expect((await readConfirmation(backend)).undoLabel).toBe("Undo creation");
	await writeFile(todoPath, "External");
	signal();
	await observed;
	expect((await readConfirmation(backend)).undoLabel).toBeUndefined();
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
	expect((await readConfirmation(backend)).undoLabel).toBe("Undo creation");
	const restarted = createSessionBackend(join(todoPath, "..", "workspaces.json"));
	cleanups.push(() => restarted.dispose());
	expect((await activateWorkspace(restarted, target.workspaceId)).undoLabel).toBeUndefined();
	const switched = await backend.switchWorkspace({ workspaceId: target.workspaceId });
	if (switched.status !== "applied") throw Error("Switch failed");
	expect(switched.confirmed.undoLabel).toBeUndefined();
	expect(
		(await backend.undoTodo({ ...target, revision: switched.confirmed.revision })).status
	).toBe("rejected");
});

test.each([
	["preserve", ["t:2026-10-14", "t:+2d", "t:2026-02-30", "custom:keep"]],
	["replace", ["custom:keep", "t:2099-01-01"]],
	["clear", ["custom:keep"]],
] as const)(
	"Show from edits %s metadata and Undo restores exact original bytes",
	async (_, metadata) => {
		const initial = "  First  +Work t:2026-10-14 t:+2d t:2026-02-30 custom:keep  \r\n\nLast";
		const { backend, target, todoPath } = await setup(initial);
		const result = await backend.editTodo({
			...target,
			lineNumber: 1,
			expectedRaw: initial.split("\r\n")[0],
			description: "Updated",
			projects: ["Work"],
			contexts: [],
			priority: null,
			creationDate: null,
			completed: false,
			completionDate: null,
			metadata: [...metadata],
		});
		expect(result.status).toBe("applied");
		if (result.status !== "applied") throw Error("Edit failed");
		expect(await readFile(todoPath, "utf8")).toBe(`Updated +Work ${metadata.join(" ")}\r\n\nLast`);
		expect(result.confirmed.todo_file.items[0].edit.metadata).toEqual(metadata);
		expect((await backend.undoTodo(targetOf(result.confirmed))).status).toBe("applied");
		expect(await readFile(todoPath, "utf8")).toBe(initial);
	}
);

test("creating a Show from through the editor payload preserves metadata and undoes the append", async () => {
	const { backend, todoPath, target, contents } = await setup();
	const result = await backend.createTodo({
		...target,
		description: "Later",
		projects: [],
		contexts: [],
		creationDate: null,
		metadata: ["t:+2d", "t:2099-01-01", "custom:keep"],
	});
	expect(result.status).toBe("applied");
	if (result.status !== "applied") throw Error("Creation failed");
	expect(await readFile(todoPath, "utf8")).toBe(
		`${contents}\r\nLater t:+2d t:2099-01-01 custom:keep`
	);
	expect((await backend.undoTodo(targetOf(result.confirmed))).status).toBe("applied");
	expect(await readFile(todoPath, "utf8")).toBe(contents);
});
