import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionBackend } from "../session-runtime";
import type { ConfirmedSession } from "@tuxedo/contracts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const target = (current: ConfirmedSession) => {
	if (current.session.status !== "ready") throw Error("Expected Ready");
	return {
		scope: current.scope,
		revision: current.revision,
		workspaceId: current.session.catalogue.active_workspace_id!,
	};
};
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "tuxedo-visibility-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	const path = join(directory, "workspaces.json");
	const backend = createSessionBackend(path);
	cleanups.push(() => backend.dispose());
	const todoPath = join(directory, "todo.txt");
	await writeFile(todoPath, "Later due:2026-11-01 t:2099-01-01\r\nEarlier due:2026-10-14\r\n");
	const created = await backend.createWorkspace({ name: "Work", color: "blue", todoPath });
	if (created.status !== "applied") throw Error(created.message);
	return { directory, path, todoPath, backend, current: created.confirmed };
}
test("Show deferred preferences survive Workspace switches and a backend restart without rewriting Todo files", async () => {
	const { directory, path, todoPath, backend, current } = await fixture();
	expect(
		current.session.status === "ready" && current.session.catalogue.workspaces[0].show_deferred
	).toBeUndefined();
	const original = await readFile(todoPath, "utf8");
	const outcome = await backend.setWorkspaceShowDeferred({
		...target(current),
		showDeferred: true,
	});
	expect(outcome.status).toBe("applied");
	const otherPath = join(directory, "other.txt");
	await writeFile(otherPath, "Other");
	const other = await backend.createWorkspace({
		name: "Personal",
		color: "green",
		todoPath: otherPath,
	});
	if (other.status !== "applied") throw Error(other.message);
	const switched = await backend.switchWorkspace({ workspaceId: target(current).workspaceId });
	expect(switched).toMatchObject({
		status: "applied",
		confirmed: {
			session: {
				catalogue: {
					workspaces: [
						expect.objectContaining({ show_deferred: true }),
						expect.not.objectContaining({ show_deferred: true }),
					],
				},
			},
		},
	});
	await backend.dispose();
	const restarted = createSessionBackend(path);
	cleanups.push(() => restarted.dispose());
	expect(await restarted.restoreSession({})).toMatchObject({
		session: {
			catalogue: {
				active_workspace_id: target(current).workspaceId,
				workspaces: [
					expect.objectContaining({ show_deferred: true }),
					expect.not.objectContaining({ show_deferred: true }),
				],
			},
		},
	});
	const reset = await restarted.setWorkspaceShowDeferred({
		...target(await restarted.readSession({})),
		showDeferred: false,
	});
	expect(reset.status).toBe("applied");
	expect(JSON.parse(await readFile(path, "utf8")).workspaces[0].show_deferred).toBe(false);
	expect(await readFile(todoPath, "utf8")).toBe(original);
});
test("saving Show deferred preserves Undo and rejects stale targets without changing the catalogue", async () => {
	const { path, backend, current } = await fixture();
	const created = await backend.createTodo({
		...target(current),
		description: "New",
		projects: [],
		contexts: [],
	});
	if (created.status !== "applied") throw Error("Expected creation");
	const outcome = await backend.setWorkspaceShowDeferred({
		...target(await backend.readSession({})),
		showDeferred: true,
	});
	expect(outcome).toMatchObject({ status: "applied", confirmed: { undoLabel: "Undo creation" } });
	const contents = await readFile(path, "utf8");
	expect(
		await backend.setWorkspaceShowDeferred({ ...target(current), showDeferred: false })
	).toMatchObject({ status: "rejected" });
	expect(await readFile(path, "utf8")).toBe(contents);
	expect(await backend.undoTodo(target(await backend.readSession({})))).toMatchObject({
		status: "applied",
	});
});
test("a corrupt catalogue is preserved and a failed save leaves confirmed visibility unchanged", async () => {
	const { path, backend, current } = await fixture();
	await writeFile(path, "{broken");
	expect(
		await backend.setWorkspaceShowDeferred({ ...target(current), showDeferred: true })
	).toMatchObject({ status: "rejected" });
	expect(await backend.readSession({})).toEqual(current);
	expect(await readFile(path, "utf8")).toBe("{broken");
});

test("invalid Workspace visibility values preserve the catalogue and confirmed session", async () => {
	const { path, backend, current } = await fixture();
	const original = await readFile(path, "utf8");
	for (const showDeferred of ["true", 1, null, undefined]) {
		expect(
			await backend.setWorkspaceShowDeferred({ ...target(current), showDeferred } as never)
		).toMatchObject({ status: "rejected" });
		expect(await readFile(path, "utf8")).toBe(original);
		expect(await backend.readSession({})).toEqual(current);
	}
	const invalid = JSON.parse(original);
	invalid.workspaces[0].show_deferred = "true";
	await writeFile(path, JSON.stringify(invalid));
	const restarted = createSessionBackend(path);
	cleanups.push(() => restarted.dispose());
	expect(await restarted.restoreSession({})).toMatchObject({ session: { status: "unavailable" } });
	expect(await readFile(path, "utf8")).toBe(JSON.stringify(invalid));
});
