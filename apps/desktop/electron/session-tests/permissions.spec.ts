import { afterEach, expect, test } from "vitest";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend } from "../session-runtime";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});

test.each(["edit", "create"])(
	"%s preserves Todo-file permissions and private catalogue defaults",
	async (operation) => {
		const directory = await mkdtemp(join(tmpdir(), "tuxedo-permissions-"));
		directories.push(directory);
		const todoPath = join(directory, "todo.txt");
		const cataloguePath = join(directory, "workspaces.json");
		await writeFile(todoPath, "Old\n");
		await chmod(todoPath, 0o664);
		const backend = createSessionBackend(cataloguePath);
		const created = await backend.createWorkspace({ name: "Work", color: "blue", todoPath });
		if (created.status !== "applied" || created.confirmed.session.status !== "ready")
			throw Error("setup");
		const input = {
			scope: created.confirmed.scope,
			revision: created.confirmed.revision,
			workspaceId: created.confirmed.session.catalogue.active_workspace_id!,
			description: "Updated",
			projects: [],
			contexts: [],
			creationDate: null,
			completed: false,
		};
		const outcome =
			operation === "edit"
				? await backend.editTodo({ ...input, lineNumber: 1, expectedRaw: "Old" })
				: await backend.createTodo(input);
		expect(outcome.status).toBe("applied");
		expect(await readFile(todoPath, "utf8")).toBe(
			operation === "edit" ? "Updated\n" : "Old\nUpdated\n"
		);
		expect((await stat(todoPath)).mode & 0o777).toBe(0o664);
		expect((await stat(cataloguePath)).mode & 0o777).toBe(0o600);
		expect((await readdir(directory)).sort()).toEqual(["todo.txt", "workspaces.json"]);
	}
);
