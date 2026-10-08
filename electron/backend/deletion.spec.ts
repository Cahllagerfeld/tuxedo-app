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
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-delete-item-"));
	directories.push(directory);
	const todoPath = join(directory, "todo.txt");
	await writeFile(todoPath, contents);
	const backend = createSessionBackend(join(directory, "workspaces.json"));
	const created = await backend.createWorkspace({ name: "Personal", color: "blue", todoPath });
	if (created.status !== "applied" || created.confirmed.session.status !== "ready")
		throw Error("Creation failed");
	return {
		directory,
		todoPath,
		backend,
		confirmed: { ...created.confirmed, session: created.confirmed.session },
	};
}
test("deletion removes exactly the targeted open Todo item and returns confirmed remaining content", async () => {
	const { todoPath, backend, confirmed } = await setup(
		"First\n(A) Delete +Work\nx 2026-07-10 Finished\n"
	);
	const result = await backend.deleteTodo({
		scope: confirmed.scope,
		revision: confirmed.revision,
		workspaceId: confirmed.session.catalogue.active_workspace_id!,
		lineNumber: 2,
		expectedRaw: "(A) Delete +Work",
	});
	expect(result.status).toBe("applied");
	expect(await readFile(todoPath, "utf8")).toBe("First\nx 2026-07-10 Finished\n");
});

test.each(["x 2026-07-10 Finished", "x 2026-07-10 Finished\n", "x 2026-07-10 Finished\r\n"])(
	"deleting the final completed item leaves an empty file (%j)",
	async (contents) => {
		const { todoPath, backend, confirmed } = await setup(contents);
		const outcome = await backend.deleteTodo({
			scope: confirmed.scope,
			revision: confirmed.revision,
			workspaceId: confirmed.session.catalogue.active_workspace_id!,
			lineNumber: 1,
			expectedRaw: "x 2026-07-10 Finished",
		});
		expect(outcome.status).toBe("applied");
		if (outcome.status === "rejected") throw Error(outcome.message);
		expect(outcome.confirmed).toMatchObject({
			scope: confirmed.scope,
			workspaceId: confirmed.session.catalogue.active_workspace_id,
			todo_file: { items: [], skipped: [] },
		});
		expect(await readFile(todoPath, "utf8")).toBe("");
		expect(await backend.readSession({})).toMatchObject({
			revision: outcome.confirmed.revision,
			session: { todo_file: outcome.confirmed.todo_file },
		});
	}
);
test("deletion rereads disk and preserves unrelated edits, skipped and blank lines, mixed endings and an unterminated final line", async () => {
	const { todoPath, backend, confirmed } = await setup("First\r\nDelete me\r\nLast");
	await writeFile(todoPath, "  (A) Edited +Work  \r\nDelete me\r\n\n+Skipped\r\nx 2026-07-10 Last");
	const result = await backend.deleteTodo({
		scope: confirmed.scope,
		revision: confirmed.revision,
		workspaceId: confirmed.session.catalogue.active_workspace_id!,
		lineNumber: 2,
		expectedRaw: "Delete me",
	});
	expect(result.status).toBe("applied");
	if (result.status === "rejected") throw Error(result.message);
	expect(await readFile(todoPath, "utf8")).toBe(
		"  (A) Edited +Work  \r\n\n+Skipped\r\nx 2026-07-10 Last"
	);
	expect(result.confirmed.todo_file).toMatchObject({
		items: [
			{ line_number: 1, raw: "  (A) Edited +Work  " },
			{ line_number: 4, raw: "x 2026-07-10 Last" },
		],
		skipped: [{ line_number: 3, raw: "+Skipped" }],
	});
});
test.each(["Changed target\nOther", "Other"])(
	"stale deletion returns current confirmed data without deleting another line (%s)",
	async (contents) => {
		const { todoPath, backend, confirmed } = await setup("Other\nDelete me");
		await writeFile(todoPath, contents);
		const result = await backend.deleteTodo({
			scope: confirmed.scope,
			revision: confirmed.revision,
			workspaceId: confirmed.session.catalogue.active_workspace_id!,
			lineNumber: 2,
			expectedRaw: "Delete me",
		});
		expect(result.status).toBe("conflict");
		expect(await readFile(todoPath, "utf8")).toBe(contents);
		if (result.status === "rejected") throw Error(result.message);
		expect((await backend.readSession({})).session).toMatchObject({
			todo_file: result.confirmed.todo_file,
		});
		expect(result.confirmed.todo_file.items.map((item) => item.raw)).toEqual(contents.split("\n"));
	}
);
test("an atomic replacement failure preserves file bytes and the prior confirmed view and cleans up temporary files", async () => {
	const { directory, todoPath, backend, confirmed } = await setup("Keep\nDelete me\n");
	await chmod(directory, 0o500);
	let result;
	try {
		result = await backend.deleteTodo({
			scope: confirmed.scope,
			revision: confirmed.revision,
			workspaceId: confirmed.session.catalogue.active_workspace_id!,
			lineNumber: 2,
			expectedRaw: "Delete me",
		});
	} finally {
		await chmod(directory, 0o700);
	}
	expect(result).toMatchObject({
		status: "rejected",
		message: expect.stringContaining("Cannot delete Todo item"),
	});
	expect(await readFile(todoPath, "utf8")).toBe("Keep\nDelete me\n");
	expect(await backend.readSession({})).toEqual(confirmed);
	expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
});

test.each(["scope", "revision", "workspace", "invalid-target"])(
	"rejected deletion (%s) cannot change the Active workspace or confirmed data",
	async (failure) => {
		const { todoPath, backend, confirmed } = await setup("Delete me\nKeep");
		const request = {
			scope: confirmed.scope,
			revision: confirmed.revision,
			workspaceId: confirmed.session.catalogue.active_workspace_id!,
			lineNumber: 1,
			expectedRaw: "Delete me",
		};
		if (failure === "scope") request.scope = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		if (failure === "revision") request.revision += 1;
		if (failure === "workspace") request.workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		if (failure === "invalid-target") request.expectedRaw = "+Only";
		expect((await backend.deleteTodo(request)).status).toBe("rejected");
		expect(await readFile(todoPath, "utf8")).toBe("Delete me\nKeep");
		expect(await backend.readSession({})).toEqual(confirmed);
	}
);
test("serialized switching rejects a queued deletion bound to the previous Workspace", async () => {
	const { directory, todoPath, backend, confirmed } = await setup("Delete me");
	const otherPath = join(directory, "other.todo");
	await writeFile(otherPath, "Other");
	const other = await backend.createWorkspace({
		name: "Other",
		color: "green",
		todoPath: otherPath,
	});
	if (other.status !== "applied") throw Error(other.message);
	const firstId = confirmed.session.catalogue.active_workspace_id!;
	const selected = await backend.switchWorkspace({ workspaceId: firstId });
	if (selected.status !== "applied") throw Error(selected.message);
	const switched = backend.switchWorkspace({
		workspaceId:
			other.confirmed.session.status === "ready"
				? other.confirmed.session.catalogue.active_workspace_id!
				: "",
	});
	const deletion = backend.deleteTodo({
		scope: selected.confirmed.scope,
		revision: selected.confirmed.revision,
		workspaceId: firstId,
		lineNumber: 1,
		expectedRaw: "Delete me",
	});
	expect((await switched).status).toBe("applied");
	expect((await deletion).status).toBe("rejected");
	expect(await readFile(todoPath, "utf8")).toBe("Delete me");
	expect(await readFile(otherPath, "utf8")).toBe("Other");
});
