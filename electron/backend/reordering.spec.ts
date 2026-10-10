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
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-reorder-"));
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

test("reordering persists displayed Todo items in their existing slots across restart", async () => {
	const { todoPath, backend, confirmed, directory } = await setup(
		"First\r\nx 2026-07-10 Hidden\n\r\nLast"
	);
	const result = await backend.reorderTodo({
		scope: confirmed.scope,
		revision: confirmed.revision,
		workspaceId: confirmed.session.catalogue.active_workspace_id!,
		lineNumbers: [4, 1],
	});
	expect(result.status).toBe("applied");
	expect(await readFile(todoPath, "utf8")).toBe("Last\r\nx 2026-07-10 Hidden\n\r\nFirst");
	const restored = await createSessionBackend(join(directory, "workspaces.json")).restoreSession(
		{}
	);
	expect(restored.session).toMatchObject({
		todo_file: {
			items: [
				{ line_number: 1, raw: "Last" },
				{ line_number: 2, raw: "x 2026-07-10 Hidden" },
				{ line_number: 4, raw: "First" },
			],
		},
	});
});
test("external edits anywhere cause a conflict without overwriting the Todo file", async () => {
	const { todoPath, backend, confirmed } = await setup("First\nLast\n");
	const contents = "First\nLast\n+Skipped\n";
	await writeFile(todoPath, contents);
	const result = await backend.reorderTodo({
		scope: confirmed.scope,
		revision: confirmed.revision,
		workspaceId: confirmed.session.catalogue.active_workspace_id!,
		lineNumbers: [2, 1],
	});
	expect(result.status).toBe("conflict");
	expect(await readFile(todoPath, "utf8")).toBe(contents);
	if (result.status === "rejected") throw Error(result.message);
	expect(result.confirmed.todo_file.skipped).toEqual([
		{ line_number: 3, raw: "+Skipped", reason: expect.any(String) },
	]);
});
test.each(["scope", "revision", "workspace", "duplicate", "unknown"])(
	"invalid or stale reorder (%s) preserves confirmed content",
	async (failure) => {
		const { todoPath, backend, confirmed } = await setup("First\nLast");
		const request = {
			scope: confirmed.scope,
			revision: confirmed.revision,
			workspaceId: confirmed.session.catalogue.active_workspace_id!,
			lineNumbers: [2, 1],
		};
		if (failure === "scope") request.scope = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		if (failure === "workspace") request.workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		if (failure === "revision") request.revision++;
		if (failure === "duplicate") request.lineNumbers = [1, 1];
		if (failure === "unknown") request.lineNumbers = [3, 1];
		expect((await backend.reorderTodo(request)).status).toBe("rejected");
		expect(await readFile(todoPath, "utf8")).toBe("First\nLast");
		expect(await backend.readSession({})).toEqual(confirmed);
	}
);
test("a failed atomic reorder preserves the file and confirmed session", async () => {
	const { directory, todoPath, backend, confirmed } = await setup("First\nLast");
	await chmod(directory, 0o500);
	try {
		expect(
			(
				await backend.reorderTodo({
					scope: confirmed.scope,
					revision: confirmed.revision,
					workspaceId: confirmed.session.catalogue.active_workspace_id!,
					lineNumbers: [2, 1],
				})
			).status
		).toBe("rejected");
	} finally {
		await chmod(directory, 0o700);
	}
	expect(await readFile(todoPath, "utf8")).toBe("First\nLast");
	expect(await backend.readSession({})).toEqual(confirmed);
	expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
});
