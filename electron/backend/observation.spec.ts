import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSessionBackend } from "./session";
import { createTodoFileObservation, type TodoFileObservationAdapter } from "./observation";
import type { TodoFileChange } from "../../src/lib/shared/desktop/contract";
import { rename } from "node:fs/promises";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});

test("observation attaches only to confirmed Active Todo files and stops in Empty", async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "tuxedo-observation-")));
	directories.push(directory);
	const paths: (string | null)[] = [];
	const observation: TodoFileObservationAdapter = {
		retarget(path) {
			paths.push(path);
		},
		stop() {},
	};
	const backend = createSessionBackend(join(directory, "workspaces.json"), observation);
	await backend.restoreSession({});
	expect(paths.at(-1)).toBe(null);
	const firstPath = join(directory, "first.todo");
	const secondPath = join(directory, "second.todo");
	await writeFile(firstPath, "First");
	await writeFile(secondPath, "Second");
	const first = await backend.createWorkspace({
		name: "First",
		color: "blue",
		todoPath: firstPath,
	});
	if (first.status !== "applied" || first.confirmed.session.status !== "ready")
		throw Error("Expected Ready");
	expect(paths.at(-1)).toBe(firstPath);
	await backend.createWorkspace({ name: "Second", color: "green", todoPath: secondPath });
	expect(paths.at(-1)).toBe(secondPath);
	await backend.switchWorkspace({
		workspaceId: first.confirmed.session.catalogue.active_workspace_id!,
	});
	expect(paths.at(-1)).toBe(firstPath);
	await rm(firstPath);
	const refreshed = await backend.restoreSession({});
	expect(refreshed.session).toMatchObject({
		status: "empty",
		warning: expect.stringContaining(firstPath),
		catalogue: { workspaces: expect.any(Array) },
	});
	expect(paths.at(-1)).toBe(null);
});

test("atomic external replacement refreshes through restoration and later deletion enters Empty", async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "tuxedo-observation-")));
	directories.push(directory);
	const observation = createTodoFileObservation();
	const changes: TodoFileChange[] = [];
	const backend = createSessionBackend(join(directory, "workspaces.json"), observation, (event) => {
		changes.push(event);
	});
	try {
		const path = join(directory, "active.todo");
		await writeFile(path, "Original");
		const created = await backend.createWorkspace({ name: "Work", color: "blue", todoPath: path });
		if (created.status !== "applied") throw Error("Expected creation");
		await writeFile(join(directory, "inactive.todo"), "Inactive edit");
		await writeFile(
			join(directory, "replacement.todo"),
			"x 2026-10-10 Finished +Home @desk\n(A) Inserted +Work\n+OnlyTag\n"
		);
		await rename(join(directory, "replacement.todo"), path);
		await expect.poll(() => changes.length, { timeout: 5000 }).toBe(1);
		expect(changes[0]).toMatchObject({
			scope: created.confirmed.scope,
			revision: created.confirmed.revision,
			todoPath: path,
		});
		const refreshed = await backend.restoreSession({});
		if (refreshed.session.status !== "ready") throw Error("Expected Ready");
		expect(refreshed.session.todo_file.items.map((item) => item.description)).toEqual([
			"Finished",
			"Inserted",
		]);
		expect(refreshed.session.todo_file.items[0].completed).toBe(true);
		expect(refreshed.session.todo_file.skipped).toHaveLength(1);
		// A brief missing entry during save should still reload as Ready.
		await rename(path, join(directory, "backup.todo"));
		await rename(join(directory, "backup.todo"), path);
		await expect.poll(() => changes.length, { timeout: 5000 }).toBe(2);
		expect((await backend.restoreSession({})).session.status).toBe("ready");
		await rm(path);
		await expect.poll(() => changes.length, { timeout: 5000 }).toBe(3);
		expect((await backend.restoreSession({})).session).toMatchObject({
			status: "empty",
			warning: expect.stringContaining(path),
		});
	} finally {
		observation.stop();
	}
});
